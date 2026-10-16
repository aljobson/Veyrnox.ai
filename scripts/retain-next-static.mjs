#!/usr/bin/env node
import { constants } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function retainDirectory(source, destination) {
    await mkdir(destination, { recursive: true });
    const entries = (await readdir(source, { withFileTypes: true }))
        .toSorted((left, right) => left.name.localeCompare(right.name));
    let result = { copied: 0, preserved: 0 };

    for (const entry of entries) {
        const sourcePath = join(source, entry.name);
        const destinationPath = join(destination, entry.name);
        let next;
        if (entry.isSymbolicLink()) {
            throw new Error(`Refusing symbolic link in retained static assets: ${sourcePath}`);
        } else if (entry.isDirectory()) {
            next = await retainDirectory(sourcePath, destinationPath);
        } else if (entry.isFile()) {
            try {
                await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
                next = { copied: 1, preserved: 0 };
            } catch (error) {
                if (error.code !== 'EEXIST') throw error;
                next = { copied: 0, preserved: 1 };
            }
        } else {
            throw new Error(`Unsupported entry in retained static assets: ${sourcePath}`);
        }
        result = {
            copied: result.copied + next.copied,
            preserved: result.preserved + next.preserved,
        };
    }
    return result;
}

export async function retainStaticAssets(source, destination) {
    if (!source || !destination) throw new Error('Both source and destination directories are required.');
    return retainDirectory(source, destination);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [source, destination] = process.argv.slice(2);
    try {
        const result = await retainStaticAssets(source, destination);
        console.log(`Retained ${result.copied} prior static file(s); kept ${result.preserved} current file(s).`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
