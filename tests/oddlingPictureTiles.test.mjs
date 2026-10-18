import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { CHARACTER_GROUPS } from '../app/veyrnox/_lib/character.js';
import { hairTileSlug } from '../app/veyrnox/_lib/oddlingHairTiles.js';
import { PICTURE_TILES, pictureTileSrc } from '../app/veyrnox/_lib/oddlingPictureTiles.js';

const optionsOf = (id) => CHARACTER_GROUPS.find((group) => group.id === id).options.map(([value]) => value);
const dirOf = (set) => new URL(`../public/oddlings/${set.dir}/`, import.meta.url);

test('every option with a picture is a real option of its group, listed once', () => {
  for (const [group, set] of Object.entries(PICTURE_TILES)) {
    assert.deepEqual(set.styles.filter((style) => !optionsOf(group).includes(style)), [], `${group}: lists an option that does not exist`);
    assert.equal(new Set(set.styles).size, set.styles.length, `${group}: duplicate`);
  }
});

test('the picture files of each group are exactly the listed options: none missing, none left over', () => {
  for (const [group, set] of Object.entries(PICTURE_TILES)) {
    const files = readdirSync(dirOf(set)).filter((name) => name.endsWith('.webp')).sort();
    assert.deepEqual(files, set.styles.map((style) => `${hairTileSlug(style)}.webp`).sort(), `${group}: files and list differ`);
  }
});

test('each picture is a small WebP, not a stray full-size render', () => {
  for (const [group, set] of Object.entries(PICTURE_TILES)) for (const style of set.styles) {
    const file = new URL(`${hairTileSlug(style)}.webp`, dirOf(set)), bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'RIFF', `${group}/${style}: not a WebP`);
    assert.equal(bytes.subarray(8, 12).toString('latin1'), 'WEBP', `${group}/${style}: not a WebP`);
    assert.ok(statSync(file).size < 40_000, `${group}/${style}: ${statSync(file).size} bytes is too large for a catalog tile`);
  }
});

test('pictureTileSrc returns the file for a listed option and nothing for the rest, including other groups and odd input', () => {
  assert.equal(pictureTileSrc('wardrobe_style', 'Business Suit'), '/oddlings/outfits/business-suit.webp');
  assert.equal(pictureTileSrc('headwear', 'Wide-Brim Hat'), '/oddlings/headwear/wide-brim-hat.webp');
  assert.equal(pictureTileSrc('hair', 'Afro'), '/oddlings/hair/afro.webp');
  assert.equal(pictureTileSrc('wardrobe_style', 'Weather Couture'), '', 'not generated yet: keeps the drawn tile');
  assert.equal(pictureTileSrc('mouth', 'Forked Tongue'), '/oddlings/face/mouth/forked-tongue.webp');
  assert.equal(pictureTileSrc('mouth', 'Small Mouth'), '', 'looked the same as No Teeth: keeps the drawn tile');
  assert.equal(pictureTileSrc('nose_shape', 'Aquiline'), '');
  assert.equal(pictureTileSrc('brows', 'Thick'), '/oddlings/face/brows/thick.webp');
  assert.equal(pictureTileSrc('chin_jaw', 'Cleft Chin'), '', 'drawn wrongly on the sheet: keeps the drawn tile');
  assert.equal(pictureTileSrc('ears', 'No Ears'), '');
  assert.equal(pictureTileSrc('horns', 'Antlers'), '/oddlings/face/horns/antlers.webp');
  assert.equal(pictureTileSrc('eyes_details', 'Scarred Eye'), '/oddlings/face/eyes_details/scarred-eye.webp');
  assert.equal(pictureTileSrc('horns', 'Curved'), '');
  assert.equal(pictureTileSrc('constructor', 'x'), '');
  assert.equal(pictureTileSrc(undefined, undefined), '');
});

test('the outfit and headwear manifests name only options that have a picture, and skip the rest with null', () => {
  for (const [file, group] of [['outfit-tiles.manifest.json', 'wardrobe_style'], ['headwear-tiles.manifest.json', 'headwear'], ['face-head-shape.manifest.json', 'head_shape'], ['face-eye-shape.manifest.json', 'eye_shape'], ['face-nose-shape.manifest.json', 'nose_shape'], ['face-mouth.manifest.json', 'mouth'], ['face-brows.manifest.json', 'brows'], ['face-lips.manifest.json', 'lips'], ['face-chin-jaw.manifest.json', 'chin_jaw'], ['face-cheeks.manifest.json', 'cheeks'], ['face-ears.manifest.json', 'ears'], ['face-facial-hair.manifest.json', 'facial_hair'], ['face-horns.manifest.json', 'horns'], ['face-face-features.manifest.json', 'face_features'], ['face-eyes-type.manifest.json', 'eyes_type'], ['face-eyes-details.manifest.json', 'eyes_details']]) {
    const manifest = JSON.parse(readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8'));
    const named = manifest.sources.flatMap((source) => source.styles).filter(Boolean);
    assert.deepEqual(named.sort(), [...PICTURE_TILES[group].styles].sort(), `${file} and the picture list differ`);
    for (const source of manifest.sources) assert.equal(source.styles.length, source.rows.reduce((a, b) => a + b, 0), `${file}/${source.file}: cell count`);
  }
});
