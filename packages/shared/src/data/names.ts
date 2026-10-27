import type { Rng } from '../rng';

const SURNAMES = [
  'Han', 'Seo', 'Baek', 'Gu', 'Mu', 'Yu', 'Jin', 'Ryu', 'Choi', 'Kang', 'Lee', 'Park', 'Hwang', 'Wi', 'Namgung',
  'Jegal', 'Dokgo', 'Hyeon', 'Sa', 'Yeon', 'Yang', 'Cheon', 'Gwak', 'Shin', 'Moon', 'Jo', 'Ahn', 'Noh', 'Bae', 'Song',
];

const GIVEN_A = ['Cheong', 'Myeong', 'Hyuk', 'Woon', 'Sung', 'Do', 'Min', 'Jae', 'Ha', 'Rok', 'Gyeol', 'Hwan', 'Seol', 'Ryeon', 'Mu', 'Yeong', 'Tae', 'Jun', 'Hae', 'Ju', 'Seon', 'Baram', 'Gang', 'Hyang', 'Eun', 'Wol'];
const GIVEN_B = ['gyeom', 'hyeon', 'woo', 'jin', 'rim', 'san', 'ho', 'seong', 'ryong', 'ran', 'hee', 'bin', 'an', 'yeon', 'soo', 'mun', 'gi', 'cheol', 'jun', 'wol', 'young', 'sik'];

export function personName(rng: Rng): string {
  return `${rng.pick(SURNAMES)} ${rng.pick(GIVEN_A)}${rng.pick(GIVEN_B)}`;
}

const PREFIX = [
  'Cloud', 'Jade', 'Iron', 'Willow', 'Red', 'Azure', 'Mist', 'Silent', 'Golden', 'Black', 'White', 'Crane', 'Dragon',
  'Tiger', 'Plum', 'Bamboo', 'Frost', 'Autumn', 'Moon', 'Thunder', 'Stone', 'Lotus', 'Phoenix', 'Pine', 'River', 'Sun',
];
const SUFFIX = ['Village', 'Brook', 'Meadow', 'Ford', 'Glen', 'Hollow', 'Rest'];

export function villageName(rng: Rng): string {
  return `${rng.pick(PREFIX)} ${rng.pick(SUFFIX)}`;
}
