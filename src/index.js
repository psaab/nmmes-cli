import loadOptions from './options.js';
import chalk from 'chalk';
import {
    Video,
    Logger
} from 'nmmes-backend';
import Path from 'path';
import fs from 'fs-extra';

// Make sure log level is at default info
// Logger.setLevel('info');

let STOPREQ = false;

process.on('SIGINT', () => STOPREQ = true);

(async () => {
    let options;
    try {
        options = await loadOptions();
    } catch (e) {
        Logger.error(e.message);
        Logger.debug(e);
        process.exit(1);
    }

    let args = options.args,
        modules = options.modules;

    if (options.args.debug)
        Logger.setLevel('trace');

    Logger.trace('Options:', options.args);

    let videos = (await getVideoPaths(args._[0])).reduce((arr, path) => {
        const outputBase = Path.basename(path, Path.extname(path)) + '.' + args.outputFormat;
        const outputPath = Path.resolve(args.tempDirectory, outputBase);
        arr.push(new Video({
            input: {
                path
            },
            output: {
                path: outputPath
            },
            modules: Object.entries(modules).map(modulePair => {
                let name = modulePair[0];
                let moduleClass = modulePair[1];

                let moduleOptions = Object.keys(moduleClass.options()).reduce((obj, key) => {
                    obj[key] = args[`${name}-${key}`];
                    return obj;
                }, {});

                return new moduleClass(moduleOptions);
            })
        }));
        return arr;
    }, []);



    if (videos.length > 1)
        Logger.info('Videos found:\n\t-', videos.map((vid) => {
            return chalk.yellow(Path.relative(options._[0], vid.input.path));
        }).join('\n\t- '));

    for (let v of videos) {
        try {
            await v.run();

            if (await fs.exists(v.output.path)) {
                const relativeDirToInput = Path.dirname(Path.relative(options._[0], v.input.path));
                const relativeDestinationDir = Path.resolve(options.destination, relativeDirToInput);
                const destination = Path.resolve(relativeDestinationDir, Path.basename(v.output.path));

                Logger.trace(`Creating destination directory ${relativeDestinationDir}.`);
                await fs.ensureDir(relativeDestinationDir);

                Logger.debug(`Moving ${chalk.bold(v.output.path)} -> ${chalk.bold(destination)}... Wait for completion message.`);
                fs.move(v.output.path, destination).then(() => Logger.debug(`Moved ${chalk.bold(v.output.path)} -> ${chalk.bold(destination)}.`), err => {
                    throw err;
                });
            }
        } catch (e) {
            if (STOPREQ) {
                Logger.warn('Stopping because SIGINT receieved.');
                break;
            }
        }
    }

    Logger.info('Processing finished.');
})();

import bluebird from 'bluebird';
import mime from 'mime';
const recursive = bluebird.promisify(require('recursive-readdir'));

export async function getVideoPaths(path) {
    function ignoreFunc(file, stats) {
        if (stats.isDirectory())
            return false;
        return !isVideo(file);
    }
    let stats = await fs.stat(path);

    if (stats.isFile() && isVideo(path)) {
        return [path];
    } else if (stats.isDirectory()) {
        return recursive(path, [ignoreFunc]);
    } else {
        throw new Error('Unsupported file type.');
    }
}

const SUPPORTED_EXTENSIONS = ['.m2ts'];

export function isVideo(path) {
    const ext = Path.extname(path);
    if (!ext) return false;
    return mime.getType(ext).startsWith('video/') || ~SUPPORTED_EXTENSIONS.indexOf(ext);
}
