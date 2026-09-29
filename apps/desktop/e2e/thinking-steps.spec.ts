import {expect} from '@playwright/test';
import {test,create,ready,open,status} from './helpers';

test('Codex and Claude thoughts share Zeron-style work summaries, ordered steps and expandable text',async({request,page})=>{
 for(const agent of ['codex','claude']){
  const title=`thinking-step-parity ${agent}`;
  const session=await create(request,title,{agent});
  await expect.poll(()=>status(request,session.id)).toBe('completed');
  await ready(page);await open(page,title);
  const group=page.locator('.activity-group').last();
  await expect(group.locator('summary')).toContainText(agent==='codex'?'Thought 2 times · Ran 2 commands':'Thought 2 times · read 1 file');
  await group.locator('summary').click();
  await expect(group.locator('.activity-row')).toHaveCount(agent==='codex'?4:3);
  const first=group.locator('.activity-detail').first();await first.getByRole('button',{name:'Thought process'}).click();
  await expect(first).toContainText('Plan the first step.');
 await expect(page.getByText('The work is complete.',{exact:true}).first()).toBeVisible();
 }
 await page.getByLabel('Open settings').click();
 await page.getByRole('switch',{name:'Compact mode'}).click();
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await expect(page.locator('.activity-group').last()).toHaveAttribute('open','');
 await expect(page.locator('.activity-group').last().getByRole('button',{name:'Thought process'})).toHaveCount(2);
});
