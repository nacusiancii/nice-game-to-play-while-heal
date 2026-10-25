// The real game against a private server: start a run, buy three misfits, sell one, fight, come back.
//   feel record first-turn
import type { Scene } from '../capture';

const UNIT_SLOT = '.shoprow .shopgroup:first-child .slot:not(.empty)';

export default async (s: Scene) => {
  await s.until(() => document.querySelector('.title-screen'), { label: 'the title screen' });
  await s.wait(300);
  await s.click('text=New run');
  await s.until(() => document.querySelector('.shoprow .slot'), { label: 'the shop' });
  s.mark('shop');
  await s.wait(500);
  for (let k = 0; k < 3; k++) {
    await s.dblclick(UNIT_SLOT);
    await s.wait(500);
  }
  if ((await s.eval(() => document.querySelectorAll('.team .slot .unit').length)) > 1) {
    s.mark('sell');
    await s.click('.team .slot .unit');
    await s.wait(400);
    await s.click('.btn.sell');
    await s.wait(700);
  }
  s.mark('fight');
  await s.key('Space');
  await s.until(() => document.querySelector('.result'), { timeout: 40000, label: 'the battle result' });
  s.mark('result');
  await s.wait(1200);
  await s.click('text=Continue');
  await s.until(() => document.querySelector('.shoprow'), { label: 'the shop again' });
  s.mark('back');
  await s.wait(1500);
};
