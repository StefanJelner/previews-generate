import pkg from './package.json' with { type: 'json' };
import c from 'ansi-colors';
import { createCanvas, loadImage } from 'canvas';
import { exec } from 'child_process';
import { program } from 'commander';
import escapeStringRegexp from 'escape-string-regexp';
import fancyLog from 'fancy-log';
import fs from 'fs';
import { globSync } from 'glob';
import { nanoid } from 'nanoid';
import path from 'path';
import { temporaryDirectory } from 'tempy';

function ffmpeg(args) {
    fancyLog(c.blue(`Invoking ffmpeg with: "ffmpeg ${args}".`));

    return new Promise((resolve) => {
        try {
            const child = exec(`ffmpeg ${args}`, { stdio: [] });
            let combined = '';

            child.stdout.on('data', (data) => (combined += data));
            child.stderr.on('data', (data) => (combined += data));

            child.on('exit', () =>
                resolve(
                    combined
                        .trim()
                        // Sometimes ffmpeg tries to simulate a status message by using the carriage return
                        // control char. We remove this here and create a real list with new lines.
                        .replace(/\r/g, '\n'),
                ),
            );
        } catch (ex) {
            resolve(ex);
        }
    });
}

function timeToSeconds(timeString) {
    return timeString
        .split(/:/g)
        .reverse()
        .reduce((acc, curr, i) => acc + parseFloat(curr) * (i === 0 ? 1 : Math.pow(60, i)), 0);
}

function secondsToTime(seconds) {
    return [2, 1, 0]
        .reduce(
            (acc, curr) => {
                const pow = curr === 0 ? 1 : Math.pow(60, curr);
                const value = curr === 0 ? +(acc[0] / pow).toFixed(2) : Math.floor(acc[0] / pow);
                const valueString = `${String(value).length === 1 ? '0' : ''}${String(value)}`;

                return [acc[0] - value * pow, acc[1].concat(valueString)];
            },
            [seconds, []],
        )[1]
        .join(':');
}

function sortAsc(a, b) {
    if (a.toLowerCase() < b.toLowerCase()) {
        return -1;
    } else if (a.toLowerCase() > b.toLowerCase()) {
        return 1;
    }
    return 0;
}

function getPreviewFilename(filename, suffix) {
    const parsed = path.parse(filename);
    return path.resolve(parsed.dir, `${parsed.name}${suffix}`);
}

async function getStatistics(videoFile) {
    // First we try the most simple way to determine the video duration by just using the plain statistics
    // from ffmpeg
    const videoStatistics = await ffmpeg(`-i "${videoFile}"`);
    const regexp = new RegExp(
        // Find input 0
        'Input #0,' +
            '.+?' +
            // Find the filename
            "'" +
            escapeStringRegexp(videoFile) +
            "':" +
            '.+?' +
            // Find the duration
            'Duration:' +
            '\\s*' +
            // Find the duration value
            '([^,]+)' +
            ',' +
            // Find the video
            '.+?Video:' +
            '.*?' +
            // Find the video resolution
            '([1-9][0-9]+)x([1-9][0-9]+)' +
            // Then two options
            '(?:' +
            // Option 1: SAR and DAR are given with aspect ratio information
            '\\s+\\[SAR\\s+[0-9]+:[0-9]+\\s+DAR\\s+([0-9]+):([0-9]+)\\]' +
            // Or
            '|' +
            // Option 2: just a comma with no aspect ratio
            ',' +
            ')',
        'si',
    );
    let duration = null;
    let width = null;
    let height = null;

    if (regexp.test(videoStatistics) === true) {
        // First get $1 to $5, treating it like raw eggs
        const durationTime = RegExp.$1;
        width = parseInt(RegExp.$2);
        const allegedHeight = parseInt(RegExp.$3);
        const aspectWidth = parseInt(RegExp.$4);
        const aspectheight = parseInt(RegExp.$5);

        duration = timeToSeconds(durationTime);

        // Sometimes the duration information is wrong. We try to get a frame close to the end and see
        // if an error message is thrown. If so, we have to try the alternative method.
        const ffmpegError = 'Output file is empty, nothing was encoded';
        const frameBeforeToTheEnd = await ffmpeg(`-i "${videoFile}" -ss ${secondsToTime(duration - 1)} -f null -`);

        if (frameBeforeToTheEnd.indexOf(ffmpegError) !== -1) {
            duration = null;
        } else {
            // Now we try to find out whether the clip might be longer than the given duration.
            const frameAfterToTheEnd = await ffmpeg(`-i "${videoFile}" -ss ${secondsToTime(duration + 1)} -f null -`);

            if (frameAfterToTheEnd.indexOf(ffmpegError) === -1) {
                duration = null;
            }
        }

        if (!isNaN(width)) {
            // If an aspect ratio is given, the real height is calculated by the width together with the aspect ratio
            if (!isNaN(aspectWidth) && !isNaN(aspectheight)) {
                height = Math.floor((width / aspectWidth) * aspectheight);
            } else {
                // If no aspect ratio is given, the height is the alleged height
                if (!isNaN(allegedHeight)) {
                    height = allegedHeight;
                }
            }
        } else {
            width = null;
        }
    }

    // Many video streams have corrupt video duration information. This is why a full decode is necessary,
    // which takes significantly longer, but gives more accurate duration information.
    if (duration === null) {
        const videoStatistics = (await ffmpeg(`-v quiet -stats -i "${videoFile}" -f null -`)).split(/\n/g);

        if (
            Array.isArray(videoStatistics) &&
            videoStatistics.length > 0 &&
            /time=(\S+)/.test(videoStatistics[videoStatistics.length - 1]) === true
        ) {
            duration = timeToSeconds(RegExp.$1);
        }
    }

    return [duration, width, height];
}

function getFillText(videoFile, folder, options) {
    if ((options.addFilenameAbs ?? false) === true) {
        return videoFile;
    }

    if ((options.addFilenameRel ?? false) === true) {
        return path.relative(folder, videoFile);
    }

    if ((options.addFilename ?? false) === true) {
        return path.parse(videoFile).base;
    }

    return '';
}

function round(value, decimals) {
    return +value.toFixed(decimals);
}

if (/ffmpeg version /i.test(await ffmpeg('-version')) === false) {
    fancyLog(c.red(`The ffmpeg executable is not installed or not within PATH.`));
}

program.name(pkg.name);
program.description(pkg.description);
program.version(pkg.version);

program
    .option('-g, --glob <string>', 'glob for finding video files', '**/*.{asf,avi,flv,mkv,mov,mpg,mp4,vob,wmv}')
    .option('-w, --width <number>', 'width of the preview', 1920)
    .option('-h, --height <number>', 'height of the preview', 1080)
    .option('-q, --quality <number>', 'jpg quality of the preview', 100)
    .option('-c, --columns <number>', 'amount of columns in the preview', 9)
    .option('-r, --rows <number>', 'amount of rows in the preview', 7)
    .option('-s, --suffix <string>', 'suffix of the preview filename', '.preview.jpg')
    .option('-f, --font <string>', 'font for the texts in the preview', 'Arial')
    .option('-z, --font-size <number>', 'font size for the texts in the preview', 16)
    .option('-l, --outline-width <number>', 'outline width for the texts in the preview', 1)
    .option('-t, --temp <string>', 'folder for temporary files', '')
    .option('-b, --border-width <number>', 'width of the border between the images', 2)
    .option('-o, --overwrite', 'overwrite existing files')
    .option('-a, --add-filename', 'add the filename to the top of the preview')
    .option('-R, --add-filename-rel', 'add the relative filename to the top of the preview')
    .option('-A, --add-filename-abs', 'add the absolute filename to the top of the preview')
    .argument('<folder>', 'folder to search for video files in');

if (process.argv.length < 3) {
    program.help();
}

program.parse();

const options = program.opts();
const folder = program.args[0];

if (fs.existsSync(folder) === true) {
    process.chdir(folder);

    const videoFiles = globSync(path.resolve(options.glob), {
        nocase: true,
        nodir: true,
        windowsPathsNoEscape: true,
    })
        .filter((videoFile) => {
            // Skipping files which are smaller than 1MB, because they usually do not contain
            // any useful video material.
            if (fs.statSync(videoFile).size <= 1024 * 1024) {
                return false;
            }

            if ((options.overwrite ?? false) === true) {
                return true;
            }

            return fs.existsSync(getPreviewFilename(videoFile, options.suffix)) === false;
        })
        .sort(sortAsc);

    fancyLog(c.magenta(`Found ${videoFiles.length} video files.`));

    // for/of has to be used here because forEach does not work together with await/async.
    for (const [i, videoFile] of videoFiles.entries()) {
        fancyLog(c.cyan(`Processing "${videoFile}".`));

        const [duration, snapshotWidth, snapshotHeight] = await getStatistics(videoFile);

        if (duration === null) {
            fancyLog(c.red(`Processing "${videoFile}" failed. Could not retrieve video duration.`));
        }

        if (snapshotWidth === null) {
            fancyLog(c.red(`Processing "${videoFile}" failed. Could not retrieve video width.`));
        }

        if (snapshotHeight === null) {
            fancyLog(c.red(`Processing "${videoFile}" failed. Could not retrieve video height.`));
        }

        if (duration === null || snapshotWidth === null || snapshotHeight === null) {
            continue;
        }

        const cells = options.columns * options.rows;
        const chunkDuration = +(duration / (cells + 1)).toFixed(2);
        const tmpDir =
            options.temp.trim() === '' ? temporaryDirectory() : path.resolve(options.temp, `${i}-${nanoid()}`);
        const snapshotFilename = path.resolve(tmpDir, `%0${String(cells).length}d.jpg`);
        const hasFilename =
            (options.addFilename ?? false) === true ||
            (options.addFilenameRel ?? false) === true ||
            (options.addFilenameAbs ?? false) === true;
        const topSpace = hasFilename === true ? options.fontSize * 1.2 + options.borderWidth : 0;
        const aspectRatio = snapshotWidth / snapshotHeight;
        const availableCanvasWidth = options.width - (options.columns + 1) * options.borderWidth;
        const availableCanvasHeight = options.height - ((options.rows + 1) * options.borderWidth + topSpace);

        // First try to fit in the columns and then calculate the height according to it
        let resizedSnapshotWidth = Math.floor(availableCanvasWidth / options.columns);
        let resizedSnapshotHeight = Math.floor(resizedSnapshotWidth / aspectRatio);

        // If the calculated height does not fit all the rows, then recalculate
        if (options.rows * resizedSnapshotHeight > availableCanvasHeight) {
            resizedSnapshotHeight = Math.floor(availableCanvasHeight / options.rows);
            resizedSnapshotWidth = resizedSnapshotHeight * aspectRatio;
        }

        const fontSizeOutlineRatio = snapshotHeight / resizedSnapshotHeight;

        // If temporary directory does not exist, create it
        if (fs.existsSync(tmpDir) === false) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }

        // Ignore prettier here to keep the complex ffmpeg formatting and make it more readable
        // prettier-ignore
        await ffmpeg(
                '-i "' + videoFile + '" ' +
                '-ss ' + secondsToTime(chunkDuration) + ' ' +
                '-vf "' +
                    'fps=' + (1 / chunkDuration) + ',' +
                    'scale=' + snapshotWidth + ':' + snapshotHeight + ',' +
                    'drawtext=' +
                        'font=' + options.font + ':' +
                        'fontsize=' + Math.round(options.fontSize * fontSizeOutlineRatio) + ':' +
                        'fontcolor=white:' +
                        'borderw=' + Math.round(options.outlineWidth * fontSizeOutlineRatio) + ':' +
                        'bordercolor=black:' +
                        'x=(w-tw)/2:' +
                        'y=h-th-10:' +
                        'text=\'%{pts\\:hms}\'' +
                '" ' +
                '"' + snapshotFilename + '"',
            );

        process.chdir(tmpDir);

        const snapshots = globSync(path.resolve('*.jpg'), {
            nocase: true,
            nodir: true,
            windowsPathsNoEscape: true,
        }).sort(sortAsc);

        process.chdir(folder);

        if (snapshots.length > 0) {
            // Create the canvas
            const canvas = createCanvas(options.width, options.height);
            const ctx = canvas.getContext('2d');

            // Fill the background with black
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, options.width, options.height);

            // Copy all the snapshots onto the canvas
            for (let j = 0; j < options.rows; j++) {
                for (let k = 0; k < options.columns; k++) {
                    const l = j * options.columns + k;

                    if (typeof snapshots[l] === 'string') {
                        ctx.drawImage(
                            await loadImage(snapshots[l]),
                            options.borderWidth + k * (resizedSnapshotWidth + options.borderWidth),
                            topSpace + options.borderWidth + j * (resizedSnapshotHeight + options.borderWidth),
                            resizedSnapshotWidth,
                            resizedSnapshotHeight,
                        );
                    }
                }
            }

            // Add the filename, if necessary
            if (hasFilename === true) {
                ctx.fillStyle = 'white';
                ctx.font = `${options.fontSize}px ${options.font}`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(getFillText(videoFile, folder, options), options.borderWidth, options.borderWidth);
            }

            // Write out result to a jpeg file
            const buffer = canvas.toBuffer('image/jpeg', { quality: options.quality / 100 });

            if (buffer instanceof Buffer) {
                const previewFilename = getPreviewFilename(videoFile, options.suffix);

                fs.writeFileSync(previewFilename, buffer);

                // Success message
                fancyLog(
                    c.green(
                        `Processing "${videoFile}" succeeded. The preview "${previewFilename}" has been generated.`,
                    ),
                );
            } else {
                fancyLog(c.red(`Processing "${videoFile}" failed. Creating the buffer failed.`));
            }
        } else {
            fancyLog(c.red(`Processing "${videoFile}" failed. No snapshots have been generated.`));
        }

        // Delete temporary directory
        fs.rmSync(tmpDir, { recursive: true, force: true });

        // Showing status information
        const percent = round((i + 1) / (videoFiles.length / 100), 2);

        fancyLog(
            c.magenta(
                `${i + 1} of ${videoFiles.length} (${percent}%) video files done. ${videoFiles.length - (i + 1)} of ${
                    videoFiles.length
                } (${100 - percent}%) video files left.`,
            ),
        );
    }
} else {
    fancyLog(c.red(`The folder "${folder}" does not exist.`));
}
