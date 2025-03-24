# previews-generate

The goal of this node.js script is to create thumbnail previews from all the videos in a given folder
**in a rock solid way**.

I always considered this a simple task but after being tired of trying countless open source or freeware solutions,
i decided to write my own. Problems which occured were:

- Not all video files were found. (Escpecially .vob files were a problem.) As of now this node.js script is capable
  of finding the following file types: .asf, .avi, .flv, .mkv, .mov, .mpg, .mp4, .vob, .wmv
- Error messages were shown in a popup and had to be clicked away manually. If you have to click away 10.000 error
  message, good luck. This node.js script runs on the console and if a video fails, it only generates a descriptive
  output and then seamlessly continues without user interaction.
- Thumbnail previews were empty or otherwise faulty. This node.js script tries to overcome all known problems,
  which might occur. (F.ex. wrong duration information the file meta data. If the duration information is faulty,
  a complete decode is done beforehand to find the right duration. This might slow the process down significantly,
  but is more precise.)

To achieve this goal, ffmpeg is used extensively throughout the process.

## Prerequisites

### node.js

You need node.js on your machine and in the `PATH` environment variable.

You can download it from [the download page of the official node.js website](https://nodejs.org/en/download).

### ffmpeg

You need ffmpeg on your machine and in the `PATH` environment variable.

You can download it from [the download page of the official ffmpeg website](https://www.ffmpeg.org/download.html).

## Installation

- Checkout this repository to a local folder.
- Open a console and change to that folder.
- Run `npm install`.

## Simple usage

The most simple scenario is to just run the script only with a folder:

```sh
node ./previews-generate.mjs /location/of/my/videos
```

This will generate thumbnails with the default settings.

## CLI arguments

If you run the node.js script with the `--help` option, a help screen is shown:

```sh
node ./previews-generate.mjs --help
```

The output looks like this:

```
Usage: previews-generate [options] <folder>

Arguments:
  folder                        folder to search for video files in

Options:
  -V, --version                 output the version number
  -w, --width <number>          width of the preview (default: 1920)
  -h, --height <number>         height of the preview (default: 1080)
  -q, --quality <number>        jpg quality of the preview (default: 100)
  -c, --columns <number>        amount of columns in the preview (default: 9)
  -r, --rows <number>           amount of rows in the preview (default: 7)
  -s, --suffix <string>         suffix of the preview filename (default: ".preview.jpg")
  -f, --font <string>           font for the texts in the preview (default: "Arial")
  -z, --font-size <number>      font size for the texts in the preview (default: 16)
  -l, --outline-width <number>  outline width for the texts in the preview (default: 1)
  -t, --temp <string>           folder for temporary files (default: "")
  -b, --border-width <number>   width of the border between the images (default: 2)
  -o, --overwrite               overwrite existing files
  -a, --add-filename            add the filename to the top of the preview
  --add-filename-rel            add the relative filename to the top of the preview
  --add-filename-abs            add the absolute filename to the top of the preview
  --help                        display help for command
```
