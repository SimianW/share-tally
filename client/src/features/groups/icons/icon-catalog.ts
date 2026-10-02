import { iconNames } from 'lucide-react/dynamic';
import type { GroupIcon } from './group-icon';

export type IconChoice = { icon: GroupIcon; label: string; keywords: string };
export const iconLabel = (icon: GroupIcon) => icon.type === 'unicode' ? icon.value
  : icon.value.replaceAll('-', ' ').replace(/^./, letter => letter.toUpperCase());
const common = ['shopping-basket', 'shopping-cart', 'coffee', 'house', 'utensils', 'pizza', 'plane', 'car', 'tent', 'mountain', 'heart', 'users', 'music', 'gamepad-2', 'camera', 'gift', 'sun', 'dog', 'flower-2'];
const aliases: Record<string, string> = {
  coffee: '咖啡 cafe drink', shopping: '购物 超市 groceries costco', house: '家 房子 home',
  plane: '飞机 旅行 travel', car: '车 汽车 travel', heart: '心 爱 love', utensils: '餐具 吃饭 food',
  pizza: '披萨 食物 food', dog: '狗 宠物 pet', cat: '猫 宠物 pet', music: '音乐 歌曲',
  camera: '相机 拍照', gift: '礼物 生日 birthday', sun: '太阳 天气 weather', tent: '帐篷 露营 camp',
  mountain: '山 户外 hiking', users: '朋友 群组 friends group', flower: '花 植物 plant', game: '游戏 play', bike: '自行车',
};
export const lucideChoices: IconChoice[] = [...iconNames].sort((a, b) => {
  const ai = common.indexOf(a), bi = common.indexOf(b);
  return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.localeCompare(b);
}).map(value => {
  const icon: GroupIcon = { type: 'lucide', value };
  return { icon, label: iconLabel(icon), keywords: value.replaceAll('-', ' ') + ' ' + Object.entries(aliases)
    .filter(([key]) => value.includes(key)).map(([, words]) => words).join(' ') };
});
