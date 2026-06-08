import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./tests/resolve-ts-loader.mjs', pathToFileURL('./'));
