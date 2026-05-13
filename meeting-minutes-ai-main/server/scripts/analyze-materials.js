import { analyzeMaterials } from '../lib/styleProfile.js';

const profile = await analyzeMaterials();
console.log(JSON.stringify(profile, null, 2));
