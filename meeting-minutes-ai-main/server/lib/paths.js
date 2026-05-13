import path from 'node:path';
import { fileURLToPath } from 'node:url';

import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const projectRoot = path.resolve(__dirname, '../..');
export const materialRoot = path.resolve(projectRoot, '..');

const isVercel = process.env.VERCEL === '1';
export const uploadDir = isVercel ? path.join(os.tmpdir(), 'uploads') : path.join(projectRoot, 'uploads');
export const generatedDir = isVercel ? path.join(os.tmpdir(), 'generated') : path.join(projectRoot, 'generated');
export const styleProfilePath = isVercel ? path.join(os.tmpdir(), 'style-profile.json') : path.join(projectRoot, 'server', 'style-profile.json');
