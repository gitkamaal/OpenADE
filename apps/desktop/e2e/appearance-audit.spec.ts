import {test,ready,choose,create,open,panel,repo,otherRepo} from './helpers';
import {expect} from '@playwright/test';
import type {Theme} from '../src/ade/themes';
import * as fs from 'node:fs';
import * as path from 'node:path';
const themes:Theme[]=(JSON.parse(fs.readFileSync(new URL('../src/ade/theme-catalog.json',import.meta.url),'utf8')) as {variants:Theme[]}[]).flatMap(family=>family.variants);
const output=process.env.OPENADE_AUDIT_OUTPUT;
async function shot(page:import('@playwright/test').Page,name:string){if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,name+'.png')});}}
async function bridge(page:import('@playwright/test').Page,legacy=false){await page.addInitScript(({legacy})=>{
 if(legacy&&!localStorage.getItem("openade.audit-seeded"))localStorage.setItem('openade.preferences',JSON.stringify({theme:'dusk',dark_theme:'dusk',glass:'transparent',transparency:100,accent:'default'}));
 Object.assign(window,{go:{main:{App:{SetAppearance:async(_scheme:string,material:string)=>material}}},runtime:{EventsOn:(_name:string,callback:(status:string)=>void)=>{Object.assign(window,{appearanceChanged:callback});return()=>{};}}});
},{legacy});}

test('theme catalog, legacy migration, independent System variants and transparency persist through keyboard flows',async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width:1480,height:920});await bridge(page,true);await ready(page);
 await page.getByLabel('Open settings').click();await page.getByRole('tab',{name:'Appearance',exact:true}).click();
 await expect(page.getByLabel('Dark theme',{exact:true})).toHaveAttribute('data-value','gruvbox-dark');
 await expect(page.getByLabel('Background transparency')).toHaveValue('90');await expect(page.getByLabel('Glass',{exact:true})).toHaveAttribute('data-value','frosted');await page.getByLabel('Glass',{exact:true}).click();await expect(page.getByRole('option',{name:'Transparent',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');
 // Subsequent reloads must read saved preferences, not re-seed the legacy fixture.
 await page.evaluate(()=>localStorage.setItem('openade.audit-seeded','1'));
 const timings:number[]=[];
 await choose(page,'Glass','opaque');
 for(const theme of themes){
  await page.getByRole('button',{name:theme.appearance==='light'?'Light':'Dark',exact:true}).click();
  const start=performance.now();await choose(page,theme.appearance==='light'?'Light theme':'Dark theme',theme.id);
  await expect(page.locator('.ade')).toHaveAttribute('data-theme-id',theme.id);timings.push(performance.now()-start);
  const roles=await page.locator('.ade').evaluate(el=>{const css=getComputedStyle(el);return Object.fromEntries(['--bg','--syntax-keyword','--ansi-blue','--diff-add'].map(key=>[key,css.getPropertyValue(key).trim()]));});
  expect(roles).toEqual({'--bg':theme.colors.background,'--syntax-keyword':theme.syntax.keyword,'--ansi-blue':theme.terminal.ansi[4],'--diff-add':theme.colors.diffAdd});
  await shot(page,`theme-${theme.id}`);
 }
 await choose(page,'Dark theme','catppuccin-mocha');await choose(page,'Light theme','catppuccin-latte');await page.getByRole('button',{name:'System',exact:true}).click();
 await page.emulateMedia({colorScheme:'light'});await expect(page.locator('.ade')).toHaveAttribute('data-theme-id','catppuccin-latte');
 await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('.ade')).toHaveAttribute('data-theme-id','catppuccin-mocha');
 await choose(page,'Glass','frosted');const slider=page.getByLabel('Background transparency');await slider.focus();await slider.press('Home');await slider.press('ArrowRight');await expect(slider).toHaveValue('1');await slider.press('End');await expect(slider).toHaveValue('90');
 await slider.press('Home');for(let step=0;step<55;step++)await slider.press('ArrowRight');await expect(page.locator('.ade')).toHaveCSS('opacity','1');
 expect(await page.locator('.ade').evaluate(el=>getComputedStyle(el).getPropertyValue('--glass-coverage'))).toBe('45%');
 await choose(page,'Glass','liquid');await expect(slider).toHaveValue('55');await shot(page,'03-liquid-appearance');
 await page.getByLabel('Dark theme',{exact:true}).click();await page.getByLabel('Search dark theme').fill('Nord');await expect(page.getByRole('option',{name:'Nord',exact:true})).toBeVisible();await shot(page,'04-searchable-theme-menu');await page.keyboard.press('Enter');await expect(page.getByLabel('Dark theme',{exact:true})).toBeFocused();
 await page.getByLabel('Dark theme',{exact:true}).click();await page.keyboard.press('Tab');await expect(page.locator('.select-popover')).toHaveCount(0);await expect(page.locator('.ade.has-custom-menu')).toHaveCount(0);
 await page.reload();await page.getByLabel('Open settings').click();await page.getByRole('tab',{name:'Appearance',exact:true}).click();await expect(page.getByLabel('Background transparency')).toHaveValue('55');await expect(page.getByLabel('Dark theme',{exact:true})).toHaveAttribute('data-value','nord');
 await page.evaluate(()=>(window as typeof window&{appearanceChanged:(status:string)=>void}).appearanceChanged('reduced-transparency'));await expect(slider).toBeDisabled();
 if(output)fs.writeFileSync(path.join(output,'theme-profile.json'),JSON.stringify({themes:themes.length,themeSwitchMs:timings,bridge:'simulated native status; actual production client and Go engine'},null,2));
});

test('seamless pointer and keyboard resize preserve focus, avoid selection and commit preferences once per drag',async({page,request})=>{
 await page.setViewportSize({width:1480,height:920});await create(request,'Seamless resize audit');await ready(page);await open(page,'Seamless resize audit');
 await page.evaluate(()=>{const original=Storage.prototype.setItem;Object.assign(window,{resizeWrites:0});Storage.prototype.setItem=function(key:string,value:string){if(key==='openade.preferences')(window as typeof window&{resizeWrites:number}).resizeWrites++;original.call(this,key,value);};});
 const seam=page.getByRole('separator',{name:'Resize sidebar',exact:true});const rect=(await seam.boundingBox())!;
 await page.mouse.move(rect.x+rect.width/2,rect.y+80);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+64,rect.y+80,{steps:32});
 await expect(page.locator('.ade')).toHaveClass(/is-resizing/);await expect(seam).toHaveCSS('background-color','rgba(0, 0, 0, 0)');expect(await page.evaluate(()=>getSelection()?.toString()??'')).toBe('');
 await page.mouse.up();await expect(seam).toHaveAttribute('aria-valuenow','320');await expect(page.locator('.ade')).not.toHaveClass(/is-resizing/);
 expect(await page.evaluate(()=>(window as typeof window&{resizeWrites:number}).resizeWrites)).toBe(1);await shot(page,'05-seamless-sidebar');
 await seam.focus();await seam.press('ArrowRight');await expect(seam).toHaveAttribute('aria-valuenow','328');await seam.press('Home');await expect(seam).toHaveAttribute('aria-valuenow','224');await seam.press('End');await expect(seam).toHaveAttribute('aria-valuenow','400');
 await page.reload();await expect(seam).toHaveAttribute('aria-valuenow','400');await seam.dblclick();await expect(seam).toHaveAttribute('aria-valuenow','256');
 await panel(page,'Terminal');const right=page.getByRole('separator',{name:'Resize right sidebar',exact:true});await right.focus();const before=Number(await right.getAttribute('aria-valuenow'));await right.press('ArrowLeft');await expect(right).toHaveAttribute('aria-valuenow',String(before+8));await right.press('End');const max=await right.getAttribute('aria-valuemax');await expect(right).toHaveAttribute('aria-valuenow',max!);await right.dblclick();await expect(right).toHaveAttribute('aria-valuenow','520');
 await page.getByLabel('Close right sidebar',{exact:true}).click();await expect(page.locator('.resize-boundary:focus')).toHaveCount(0);
});

test('live themes reach editor and terminal while accessibility fallbacks preserve shell input focus',async({page,request})=>{
 await bridge(page);await create(request,'Palette workspace audit');await ready(page);await open(page,'Palette workspace audit');await page.getByLabel('Toggle files panel').click();await page.getByRole('treeitem',{name:'README.md',exact:true}).click();await page.getByRole('textbox',{name:'Edit README.md',exact:true}).focus();await shot(page,'06-editor-focus');await panel(page,'Diffs');await shot(page,'07-diff-workspace');await panel(page,'Terminal');await page.getByLabel('New terminal',{exact:true}).click();
 await page.getByLabel('Open settings').click();await page.getByRole('tab',{name:'Appearance',exact:true}).click();await choose(page,'Glass','opaque');await choose(page,'Dark theme','dracula');await page.getByRole('button',{name:'Back',exact:true}).click();await panel(page,'Terminal');await expect(page.locator('.xterm-viewport').first()).toHaveCSS('background-color','rgb(40, 42, 54)');
 const input=page.locator('.xterm-helper-textarea').first();await input.focus();await input.pressSequentially('echo THEME-FOCUS-OK');await input.press('Enter');await expect(page.locator('.xterm-rows').first()).toContainText('THEME-FOCUS-OK');await shot(page,'08-terminal-theme');
 await page.getByLabel('Open settings').click();await page.getByRole('tab',{name:'Appearance',exact:true}).click();await choose(page,'Dark theme','nord');await choose(page,'Glass','frosted');await page.getByRole('button',{name:'Back',exact:true}).click();await panel(page,'Terminal');await input.focus();await expect(page.locator('.xterm-viewport').first()).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await page.evaluate(()=>(window as typeof window&{appearanceChanged:(status:string)=>void}).appearanceChanged('reduced-transparency'));await expect(page.locator('.xterm-viewport').first()).toHaveCSS('background-color','rgb(46, 52, 64)');await expect(input).toBeFocused();await page.locator('.terminal-workspace').getByRole('button',{name:/^Close Terminal/}).click();
});


test('Settings preserves draft, dirty editor, cursor focus and native preview visibility; unavailable Sites actions are explicit',async({page,request})=>{
 await bridge(page);
 await page.addInitScript(()=>{const state=window as typeof window&{go:{main:{App:Record<string,unknown>}};previewActions:string[]};state.previewActions=[];Object.assign(state.go.main.App,{BrowserOpenTab:async()=>{},BrowserNavigateTab:async()=>{},BrowserBoundsTab:async()=>{},BrowserActionTab:async(_id:string,action:string)=>{state.previewActions.push(action);}});});
 await create(request,'Settings continuity audit');await ready(page);await open(page,'Settings continuity audit');
 const message=page.getByLabel('Session message');await message.fill('Unsent draft survives appearance adjustments');
 await page.getByLabel('Toggle files panel').click();await page.getByRole('treeitem',{name:'README.md',exact:true}).click();
 const editor=page.getByRole('textbox',{name:'Edit README.md',exact:true});await editor.focus();await page.keyboard.press('End');await page.keyboard.insertText(' — unsaved appearance audit');
 await page.keyboard.press('Control+,');await expect(page.getByRole('heading',{name:'General',exact:true})).toBeVisible();await page.getByRole('tab',{name:'Appearance',exact:true}).click();await choose(page,'Code and diff font size','14.5');await choose(page,'Dark theme','nord');await shot(page,'09-settings-with-preserved-draft');
 await page.getByRole('button',{name:'Back',exact:true}).click();await expect(editor).toContainText('unsaved appearance audit');await expect(editor).toBeFocused();await expect(message).toHaveValue('Unsent draft survives appearance adjustments');await expect(page.locator('.cm-editor')).toHaveCSS('font-size','14.5px');
 await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');await expect(page.getByLabel('Unsaved changes')).toHaveCount(0);
 await panel(page,'Browser');await page.getByLabel('Website address').fill('http://127.0.0.1:7491/');await page.getByRole('button',{name:'Go',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as typeof window&{previewActions:string[]}).previewActions.at(-1))).toBe('show');
 await page.getByRole('button',{name:'Project display settings',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as typeof window&{previewActions:string[]}).previewActions.at(-1))).toBe('hide');await page.keyboard.press('Escape');await expect.poll(()=>page.evaluate(()=>(window as typeof window&{previewActions:string[]}).previewActions.at(-1))).toBe('show');await message.fill('/');await expect(page.getByRole('listbox',{name:'Skills and commands'})).toBeVisible();await expect.poll(()=>page.evaluate(()=>(window as typeof window&{previewActions:string[]}).previewActions.at(-1))).toBe('hide');await page.keyboard.press('Escape');await message.fill('Unsent draft survives appearance adjustments');await expect.poll(()=>page.evaluate(()=>(window as typeof window&{previewActions:string[]}).previewActions.at(-1))).toBe('show');await page.getByLabel('Open settings').click();await expect.poll(()=>page.evaluate(()=>(window as typeof window&{previewActions:string[]}).previewActions.at(-1))).toBe('hide');
 await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.getByLabel('Website address')).toHaveValue('http://127.0.0.1:7491/');await expect.poll(()=>page.evaluate(()=>(window as typeof window&{previewActions:string[]}).previewActions.at(-1))).toBe('show');
 await page.getByRole('button',{name:'Home',exact:true}).click();await open(page,'Settings continuity audit');await expect(message).toHaveValue('Unsent draft survives appearance adjustments');
 await page.getByRole('button',{name:'Sites',exact:true}).click();await expect(page.getByRole('heading',{name:'Sites are not connected',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Create',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Create new site',exact:true})).toBeDisabled();await shot(page,'10-sites-capability');
});

test('project picker and every reachable custom choice open at their trigger; Compact visibly removes metadata and persists',async({page,request})=>{
 await page.setViewportSize({width:1480,height:920});await create(request,'Project menu audit');await create(request,'Other project menu audit',{repo_root:otherRepo});await create(request,'Newest outside filtered project');await ready(page);
 const picker=page.getByRole('combobox',{name:'Filter projects',exact:true});await picker.click();await expect(page.getByPlaceholder('Search projects…')).toBeFocused();const anchor=(await picker.boundingBox())!;await expect.poll(async()=>Math.abs((await page.locator('.select-popover').boundingBox())!.x-anchor.x)).toBeLessThan(2);await expect.poll(async()=>Math.abs((await page.locator('.select-popover').boundingBox())!.y-anchor.y-anchor.height-6)).toBeLessThan(2);await shot(page,'11-project-picker');await page.getByLabel('Search filter projects').fill('fixture');await expect(page.locator('[role=option][data-value=""]')).toBeVisible();await page.locator(`[role=option][data-value="${otherRepo}"]`).click();await expect(picker).toHaveAttribute('data-value',otherRepo);await expect(page.locator('.sidebar-chat-row[title="Project menu audit"]')).toHaveCount(0);await page.keyboard.press('Control+Tab');await expect(page.locator('.session-title h1')).toHaveText('Other project menu audit');await page.getByRole('button',{name:'Home',exact:true}).click();await choose(page,'Filter projects','');
 await page.getByRole('button',{name:'Project display settings',exact:true}).click();const dots=(await page.getByRole('button',{name:'Project display settings',exact:true}).boundingBox())!;await expect.poll(async()=>Math.abs((await page.locator('.project-menu-wrap').boundingBox())!.x-dots.x-dots.width-6)).toBeLessThan(2);
 await choose(page,'Organize sidebar','list');await expect(page.getByRole('menu',{name:'Project display settings',exact:true})).toBeVisible();await page.getByRole('menuitem',{name:'Show',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'Branch',exact:true}).click();await page.keyboard.press('Escape');await page.getByRole('menuitemcheckbox',{name:'Compact',exact:true}).click();const row=page.locator('.sidebar-chat-row[title="Project menu audit"]').first();await expect(row.locator('.branch-metadata')).toBeVisible();await expect(row).toHaveCSS('min-height','61px');await shot(page,'12-expanded-sidebar');await page.getByRole('menuitemcheckbox',{name:'Compact',exact:true}).click();await expect(row.locator('.branch-metadata')).toBeHidden();await expect(row).toHaveCSS('min-height','29px');await shot(page,'13-compact-sidebar');await page.keyboard.press('Escape');await page.getByLabel('Filter projects',{exact:true}).click();await page.keyboard.press('Control+b');await expect(page.locator('.select-popover')).toHaveCount(0);await expect(page.locator('.ade.has-custom-menu')).toHaveCount(0);await page.keyboard.press('Control+b');await page.reload();await expect(row).toHaveCSS('min-height','29px');
 const checked:string[]=[];
 async function inspectChoices(){const controls=page.locator('button[role=combobox]:visible');const labels=await controls.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')!));for(const label of labels){const trigger=page.getByRole('combobox',{name:label,exact:true});if(await trigger.isDisabled())continue;await trigger.click();const menu=page.locator('.select-popover');await expect(menu).toBeVisible();await expect(trigger).toHaveAttribute('aria-expanded','true');const r=(await menu.boundingBox())!;expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(1480);expect(r.y+r.height).toBeLessThanOrEqual(921);await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(menu).toHaveCount(0);checked.push(label);}}
 await inspectChoices();await page.getByLabel('Open settings').click();for(const section of ['General','Appearance','Notifications','Shortcuts','Providers','Files']){const tab=page.getByRole('tab',{name:section,exact:true});if(!await tab.count())continue;await tab.click();await inspectChoices();}await expect(page.locator('select,datalist')).toHaveCount(0);if(output)fs.writeFileSync(path.join(output,'dropdown-inventory.json'),JSON.stringify({customChoices:[...new Set(checked)],verification:'opens custom popup, expanded state, viewport containment, Escape, focus return'},null,2));
});

test('action menus open visibly, navigate with arrows, return focus and perform their chosen action',async({page,request})=>{
 await page.setViewportSize({width:1480,height:920});await create(request,'Action menu audit');await ready(page);await open(page,'Action menu audit');
 const actions=page.getByLabel('Session actions',{exact:true});await actions.click();const rename=page.getByRole('menuitem',{name:'Rename chat',exact:true});await expect(rename).toBeFocused();await rename.press('ArrowDown');await expect(page.getByRole('menuitem',{name:'Chat instructions',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(actions).toBeFocused();await expect(page.locator('.session-actions')).toHaveCount(0);
 await actions.click();await rename.press('Enter');await expect(page.getByRole('dialog',{name:'Rename chat',exact:true})).toBeVisible();await page.getByLabel('Chat title').fill('Action menu renamed');await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('.session-title h1')).toHaveText('Action menu renamed');
 await page.getByLabel('Toggle right sidebar').click();const add=page.getByLabel('Add panel',{exact:true});await add.click();const browser=page.getByRole('menuitem',{name:'Browser',exact:true});await expect(browser).toBeFocused();await browser.press('ArrowDown');await expect(page.getByRole('menuitem',{name:'Terminal',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(add).toBeFocused();await add.click();await page.getByRole('menuitem',{name:'Diffs',exact:true}).click();await expect(page.getByLabel('Diff scope')).toBeVisible();await expect(page.getByLabel('Toggle right sidebar')).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Home',exact:true}).click();await page.getByLabel('Filter projects',{exact:true}).click();await page.getByRole('button',{name:'New project…',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:'New project',exact:true})).toBeVisible();await expect(page.locator('.select-popover')).toHaveCount(0);
});

test('narrow panes retain readable diff choices, reachable actions and truthful resize limits',async({page,request})=>{
 await create(request,'Narrow pane audit');await page.setViewportSize({width:1280,height:720});await ready(page);await open(page,'Narrow pane audit');await panel(page,'Diffs');await page.getByLabel('Toggle files panel').click();const scope=page.getByRole('combobox',{name:'Diff scope',exact:true});await expect(scope).toBeVisible();expect(await scope.locator('span').evaluate(el=>el.clientWidth>=el.scrollWidth)).toBe(true);await choose(page,'Diff scope','turn');await expect(scope).toHaveAttribute('data-value','turn');const composer=page.locator('.session-composer');const cr=(await composer.boundingBox())!;const send=(await page.getByLabel('Send message').boundingBox())!;expect(send.x+send.width).toBeLessThanOrEqual(cr.x+cr.width);await expect(page.locator('.session-status-announcement')).toBeAttached();await expect(page.locator('.session-context .runtime-chip,.session-context .skills-shortcut')).toHaveCount(0);await shot(page,'15-narrow-workspace');
 await page.setViewportSize({width:1040,height:680});const left=page.getByRole('separator',{name:'Resize sidebar',exact:true});await left.focus();await left.press('End');const right=page.getByRole('separator',{name:'Resize right sidebar',exact:true});await expect(right).toHaveAttribute('aria-disabled','true');await expect.poll(()=>right.evaluate(el=>el.getAttribute('aria-valuenow')===el.getAttribute('aria-valuemax')&&el.getAttribute('aria-valuemin')===el.getAttribute('aria-valuemax'))).toBe(true);await expect(right).toHaveAttribute('tabindex','-1');await page.setViewportSize({width:1480,height:920});await expect(right).toHaveAttribute('aria-disabled','false');await expect(scope).toBeVisible();
});

test('global palette searches every local chat, preserves focus and applies source actions without repeat activation',async({page,request})=>{
 await create(request,'Palette outside project',{repo_root:otherRepo});const archived=await create(request,'Palette archived result');await page.addInitScript(id=>localStorage.setItem('openade.preferences',JSON.stringify({sidebar_project_filter:'unmatched-project',archived_sessions:[id]})),archived.id);await ready(page);const composer=page.getByLabel('New session prompt');await composer.fill('Keep this new-chat draft');await composer.focus();await page.keyboard.press('Control+k');const search=page.getByRole('combobox',{name:'Search commands and chats',exact:true});await expect(search).toBeFocused();await search.fill('Palette archived');await expect(page.getByRole('option',{name:/Palette archived result Archived/})).toBeVisible();await search.fill('Palette outside');await expect(page.getByRole('option',{name:/Palette outside project/})).toBeVisible();await page.keyboard.press('Escape');await expect(composer).toBeFocused();await expect(composer).toHaveValue('Keep this new-chat draft');await page.keyboard.press('Control+k');await search.fill('switch to light');await page.keyboard.press('Enter');await expect(page.locator('.ade')).toHaveAttribute('data-theme-appearance','light');await expect(page.getByRole('dialog',{name:'Commands and chats'})).toBeVisible();await search.fill('Palette outside');await page.keyboard.press('Enter');await expect(page.locator('.session-title h1')).toHaveText('Palette outside project');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'Search commands and chats',exact:true}).click();await search.fill('Open settings');await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'General',exact:true})).toBeVisible();await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.locator('.session-title h1')).toHaveText('Palette outside project');
});

test('editor context actions use a custom source menu and preserve selection, undo and disabled states',async({page,request})=>{
 await create(request,'Editor menu parity');await ready(page);await open(page,'Editor menu parity');await page.getByLabel('Toggle files panel').click();await page.getByRole('treeitem',{name:'README.md',exact:true}).click();const editor=page.getByRole('textbox',{name:'Edit README.md',exact:true});const original=await editor.innerText();await editor.focus();await page.keyboard.press(process.platform==='darwin'?'Meta+a':'Control+a');await editor.click({button:'right'});const menu=page.getByRole('menu',{name:'Editor actions'});await expect(menu).toBeVisible();await expect(menu.getByRole('menuitem',{name:'Copy',exact:true})).toBeEnabled();await menu.getByRole('menuitem',{name:'Copy',exact:true}).click();await expect(editor).toBeFocused();await editor.click({button:'right'});await menu.getByRole('menuitem',{name:'Select All',exact:true}).click();await editor.click({button:'right'});await menu.getByRole('menuitem',{name:'Cut',exact:true}).click();await expect(editor).toBeEmpty();await editor.click({button:'right'});await expect(menu.getByRole('menuitem',{name:'Copy',exact:true})).toBeDisabled();await expect(menu.getByRole('menuitem',{name:'Paste',exact:true})).toBeEnabled();await menu.getByRole('menuitem',{name:'Paste',exact:true}).click();await expect.poll(()=>editor.innerText()).toBe(original);await expect(editor).toBeFocused();await editor.click({button:'right'});await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(editor).toBeFocused();
});

test('terminal tabs reorder by drag and keyboard, persist order and middle-click releases the selected terminal',async({page,request})=>{
 await create(request,'Terminal tab parity');await ready(page);await open(page,'Terminal tab parity');await panel(page,'Terminal');const add=page.getByLabel('New terminal',{exact:true});await add.click();await expect(page.locator('.xterm')).toHaveCount(1);await add.click();const tabs=page.locator('.terminal-tabs button[data-terminal-id]');await expect(tabs).toHaveCount(2);const before=await tabs.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-terminal-id')));await tabs.nth(1).focus();await tabs.nth(1).press('Alt+ArrowLeft');await expect(tabs.first()).toHaveAttribute('data-terminal-id',before[1]!);await tabs.first().dragTo(tabs.last());await expect(tabs.first()).toHaveAttribute('data-terminal-id',before[0]!);await page.reload();await panel(page,"Terminal");await expect(tabs).toHaveCount(2);await expect(tabs.first()).toHaveAttribute('data-terminal-id',before[0]!);await tabs.last().click({button:'middle'});await expect(tabs).toHaveCount(0);await expect(page.locator('.xterm')).toHaveCount(1);await page.locator('.terminal-workspace').getByRole('button',{name:/^Close Terminal/}).click();await expect(page.locator('.terminal-empty')).toBeVisible();await page.reload();await panel(page,'Terminal');await expect(page.locator('.terminal-empty')).toBeVisible();await expect(page.locator('.xterm')).toHaveCount(0);
});

test('sidebar submenus follow pointer intent and Created/By device operate on real local sessions',async({page,request})=>{
 await page.setViewportSize({width:1480,height:920});const older=await create(request,'Created older session');await create(request,'Created newest session');await request.patch(`http://127.0.0.1:7455/api/sessions/${older.id}`,{data:{title:'Created older renamed'}});await ready(page);await page.getByLabel('Project display settings',{exact:true}).click();const organize=page.locator('.sidebar-menu-row').first();await organize.hover({position:{x:30,y:15}});await expect(page.getByRole('listbox',{name:'Organize sidebar',exact:true})).toBeVisible();await expect(page.getByRole('option',{name:'By device',exact:true})).toBeVisible();const ob=(await organize.boundingBox())!,sort=page.locator('.sidebar-menu-row').nth(1),sb=(await sort.boundingBox())!;await page.mouse.move(ob.x+35,ob.y+ob.height-3);await page.mouse.move(ob.x+160,sb.y+3);await expect(page.getByRole('combobox',{name:'Organize sidebar',exact:true})).toHaveAttribute('aria-expanded','true');await expect(page.getByRole('listbox',{name:'Sort chats',exact:true})).toBeVisible();await expect(page.getByRole('option',{name:'Created',exact:true})).toBeVisible();await page.getByRole('option',{name:'Created',exact:true}).click();await expect(page.getByRole('listbox',{name:'Sort chats',exact:true})).toHaveCount(0);await expect(page.getByRole('menu',{name:'Project display settings',exact:true})).toBeVisible();await choose(page,'Organize sidebar','device');await page.keyboard.press('Escape');await expect(page.locator('.project-flat-list .sidebar-section-title')).toHaveText('Local');await expect(page.locator('.project-flat-list .sidebar-chat-row').first()).toHaveAttribute('title','Created newest session');await page.reload();await expect(page.locator('.project-flat-list .sidebar-chat-row').first()).toHaveAttribute('title','Created newest session');
});

test('New project uses a local folder palette, registers without a chat and supports non-Git folder workspaces',async({page,request})=>{
 const os=await import('node:os');const folder=fs.mkdtempSync(path.join(os.tmpdir(),'openade-folder-parity-'));fs.writeFileSync(path.join(folder,'README.md'),'# Plain folder\n');try{
 await ready(page);await page.getByLabel('Filter projects',{exact:true}).click();await page.getByRole('button',{name:'New project…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'New project',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('option',{name:'Local',exact:true}).click();await expect(dialog.getByRole('listbox',{name:'Project locations'})).toBeVisible();await dialog.getByRole('option',{name:'Home',exact:true}).click();const search=dialog.getByRole('combobox',{name:'Search folders',exact:true});await expect(search).toBeFocused();await search.fill(folder);await search.press('Enter');await expect(dialog.locator('.project-palette-add>span')).toHaveText('Folder workspace');await expect(dialog.getByRole('button',{name:'Add project',exact:true})).toBeEnabled();await search.fill(path.join(folder,'README.md'));await search.press('Enter');await expect(dialog.getByRole('alert')).toContainText('choose an existing folder');await expect(dialog.getByRole('button',{name:'Add project',exact:true})).toBeDisabled();await search.fill(folder);await search.press('Enter');await expect(dialog.getByRole('button',{name:'Add project',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Add project',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('combobox',{name:'Choose project',exact:true})).toHaveAttribute('data-value',fs.realpathSync(folder));await expect(page.getByRole('combobox',{name:'Checkout mode',exact:true})).toBeDisabled();await page.getByLabel('New session prompt').fill('Plain folder native chat');await choose(page,'Provider','codex');await page.getByLabel('Start session',{exact:true}).click();await expect(page.locator('.session-title h1')).toHaveText('Plain folder native chat');await expect(page.locator('.session-title code')).toHaveText('Folder workspace');await page.getByLabel('Toggle files panel').click();await page.getByRole('treeitem',{name:'README.md',exact:true}).click();await expect(page.getByRole('textbox',{name:'Edit README.md',exact:true})).toContainText('Plain folder');await panel(page,'Diffs');await expect(page.getByText('Git diffs and staging are available in Git projects.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Home',exact:true}).click();await page.reload();await page.getByLabel('Filter projects',{exact:true}).click();await expect(page.locator(`.select-popover [role=option][data-value="${fs.realpathSync(folder)}"]`)).toBeVisible();await page.keyboard.press('Escape');
 const relative=await request.get('http://127.0.0.1:7455/api/projects/directories?path=../../');expect(relative.status()).toBe(400);const invalid=await request.post('http://127.0.0.1:7455/api/projects',{data:{path:path.join(folder,'README.md')}});expect(invalid.status()).toBe(400);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});

test('New project mirrors device, location and folder navigation with searchable mounted drives',async({page,request})=>{
 const response=await request.get('http://127.0.0.1:7455/api/projects/locations');expect(response.status()).toBe(200);
 const locations=(await response.json()).locations as {name:string;path:string}[];
 expect(locations[0]).toEqual({name:'Home',path:(await import('node:os')).homedir()});
 const system=locations.find(location=>location.path==='/');expect(system).toBeTruthy();
 await ready(page);await page.getByLabel('Filter projects',{exact:true}).click();await page.getByRole('button',{name:'New project…',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'New project',exact:true});
 const deviceSearch=dialog.getByRole('combobox',{name:'Search devices'});await expect(deviceSearch).toBeFocused();await deviceSearch.press('Enter');
 const locationSearch=dialog.getByRole('combobox',{name:'Search locations'});await expect(locationSearch).toBeFocused();
 await expect(dialog.getByRole('option',{name:'Home',exact:true})).toBeVisible();
 await expect(dialog.getByRole('option',{name:system!.name,exact:true})).toBeVisible();
 await locationSearch.fill('no-location-has-this-name');await expect(dialog.getByText('No locations found')).toBeVisible();
 await locationSearch.fill(system!.name);await locationSearch.press('ArrowRight');
 const folderSearch=dialog.getByRole('combobox',{name:'Search folders'});await expect(folderSearch).toBeFocused();
 await expect(dialog.locator('.project-palette-breadcrumb')).toContainText(system!.name);
 await folderSearch.press('Backspace');await expect(locationSearch).toBeFocused();
 await locationSearch.press('ArrowLeft');await expect(deviceSearch).toBeFocused();
 await deviceSearch.press('Enter');await expect(dialog.getByRole('option',{name:'Home',exact:true})).toBeEnabled();await locationSearch.press('Enter');await expect(folderSearch).toBeFocused();
 await dialog.getByRole('button',{name:'Back',exact:true}).click();await expect(locationSearch).toBeFocused();
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
});

test('deep New project breadcrumbs fold into an anchored keyboard menu',async({page})=>{
 const os=await import('node:os');const root=fs.mkdtempSync(path.join(os.homedir(),'.openade-picker-crumb-'));
 const deep=path.join(root,'a','b','c','d','e');fs.mkdirSync(deep,{recursive:true});
 try{
  await ready(page);await page.getByLabel('Filter projects',{exact:true}).click();await page.getByRole('button',{name:'New project…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'New project',exact:true});
  await dialog.getByRole('option',{name:'Local',exact:true}).click();await dialog.getByRole('option',{name:'Home',exact:true}).click();
  const search=dialog.getByRole('combobox',{name:'Search folders'});await search.fill(deep);await search.press('Enter');
  const folded=dialog.getByRole('button',{name:'Show hidden folders'});await expect(folded).toBeVisible();await folded.click();
  const menu=page.getByRole('menu',{name:'Hidden project folders'});await expect(menu).toBeVisible();await expect(menu.getByRole('menuitem',{name:'b',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(folded).toBeFocused();await expect(dialog).toBeVisible();
  await folded.click();await menu.getByRole('menuitem',{name:'b',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'b',exact:true})).toBeDisabled();await expect(dialog.getByRole('option',{name:'c',exact:true})).toBeVisible();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('Zeron composer pill expands, grows, collapses and anchors its custom model menu',async({page,request})=>{
 await page.setViewportSize({width:1480,height:920});await create(request,'Composer geometry audit');await ready(page);const home=(await page.locator('.source-new-composer').boundingBox())!;expect(home.width).toBe(768);expect(home.height).toBeCloseTo(120,1);await open(page,'Composer geometry audit');
 const form=page.locator('.session-composer'),input=page.getByLabel('Session message');
 await expect(form).toHaveAttribute('data-layout','compact');await expect.poll(async()=>Math.round((await form.boundingBox())!.height)).toBe(49);
 await input.fill('Short draft');await expect(form).toHaveAttribute('data-layout','compact');
 await input.fill('First line\nSecond line');await expect(form).toHaveAttribute('data-layout','expanded');await expect.poll(async()=>(await form.boundingBox())!.height).toBeGreaterThanOrEqual(104);
 await page.getByLabel('Choose model',{exact:true}).click();await expect(page.getByLabel('Search models')).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByLabel('Choose model',{exact:true})).toBeFocused();
 await input.fill(Array.from({length:30},(_,i)=>`Draft line ${i}`).join('\n'));expect((await form.boundingBox())!.height).toBeLessThanOrEqual(304);expect(await input.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await input.fill('');await expect(form).toHaveAttribute('data-layout','compact');await expect.poll(async()=>Math.round((await form.boundingBox())!.height)).toBe(49);
 await input.fill('A longer single line '.repeat(8));await expect(form).toHaveAttribute('data-layout','expanded');await input.fill('Draft preserved');await expect(form).toHaveAttribute('data-layout','compact');
 await page.setViewportSize({width:580,height:700});await expect(input).toHaveValue('Draft preserved');expect(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await page.setViewportSize({width:1480,height:920});await expect(form).toHaveAttribute('data-layout','compact');
 await page.getByLabel('Choose model',{exact:true}).click();const menu=(await page.locator('.model-menu').boundingBox())!,trigger=(await page.getByLabel('Choose model',{exact:true}).boundingBox())!;expect(menu.y+menu.height).toBeLessThanOrEqual(trigger.y+3);await expect.poll(async()=>{const settled=(await page.locator('.model-menu').boundingBox())!,anchor=(await page.getByLabel('Choose model',{exact:true}).boundingBox())!;return Math.abs(settled.x+settled.width-anchor.x-anchor.width)}).toBeLessThan(2);await page.keyboard.press('Escape');
 await shot(page,'52-browser-source-composer-compact');await input.fill('First line\nSecond line');await shot(page,'53-browser-source-composer-expanded');
});

test('recorded chat chrome keeps the five-icon rail, compact footer and sliding right side',async({page,request})=>{
 await page.setViewportSize({width:1480,height:920});await create(request,'Recorded chat chrome');await ready(page);await open(page,'Recorded chat chrome');
 const nav=page.getByRole('navigation',{name:'Primary'});for(const name of ['Home','Sites','Sessions','Workflows','Review'])await expect(nav.getByRole('button',{name,exact:true})).toBeVisible();await expect(nav.getByRole('button')).toHaveCount(5);
 await expect(page.locator('.session-composer')).toHaveAttribute('data-layout','compact');await expect(page.locator('.session-context')).toContainText('Local checkout');await expect(page.locator('.session-context .runtime-chip,.session-context .skills-shortcut')).toHaveCount(0);await expect(page.getByRole('button',{name:'Context usage —'})).toHaveCount(0);
 const workspace=page.locator('.session-workspace');expect(await workspace.evaluate(el=>getComputedStyle(el).transitionDuration)).toContain('0.2s');await page.getByLabel('Toggle files panel').click();await expect.poll(async()=>Math.round((await page.locator('.files-panel-clip').boundingBox())!.width)).toBe(286);await expect(nav.getByRole('button')).toHaveCount(5);
 await page.getByLabel('Toggle right sidebar').click();await expect.poll(async()=>(await page.locator('.work-panel-clip').boundingBox())!.width).toBeGreaterThan(400);await expect(page.locator('.work-panel')).toBeVisible();await page.getByLabel('Toggle right sidebar').click();await expect.poll(async()=>Math.round((await page.locator('.work-panel-clip').boundingBox())!.width)).toBe(0);await expect(nav.getByRole('button')).toHaveCount(5);
});

test('long user messages use the source width and accessible five-line fold',async({page,request})=>{
 const prompt=Array.from({length:12},(_,i)=>`Source prompt line ${i}`).join('\n');await create(request,'Message fold audit',{prompt});await ready(page);await open(page,'Message fold audit');
 const bubble=page.locator('.chat-user-turn').first(),text=bubble.locator('.user-prompt-text');await expect(bubble.getByLabel('Expand message')).toBeVisible();
 const before=(await text.boundingBox())!.height;expect(before).toBe(110);await bubble.getByLabel('Expand message').click();expect((await text.boundingBox())!.height).toBeGreaterThan(before);await bubble.getByLabel('Collapse message').click();expect((await text.boundingBox())!.height).toBe(before);
 const width=(await bubble.boundingBox())!.width,timeline=(await page.locator('.chat-timeline').boundingBox())!.width;expect(width).toBeLessThanOrEqual(timeline*.8+1);
});

test('chat, workspace and files reflow together when the window and sidebar change width',async({page,request})=>{
 await page.setViewportSize({width:1480,height:920});await create(request,'Three surface layout');await ready(page);await open(page,'Three surface layout');
 await page.getByLabel('Toggle files panel').click();await panel(page,'Browser');
 const workspace=page.locator('.session-workspace'),conversation=workspace.locator('.conversation'),work=workspace.locator('.work-panel-clip'),files=workspace.locator('.files-panel-clip');
 const widths=async()=>({chat:(await conversation.boundingBox())!.width,work:(await work.boundingBox())!.width,files:(await files.boundingBox())!.width});
 await expect.poll(async()=>{const size=await widths();return size.chat>=300&&size.work>=340&&size.files>=200&&await workspace.evaluate(el=>el.scrollWidth<=el.clientWidth+1);}).toBe(true);
 await page.setViewportSize({width:1040,height:800});
 await expect.poll(async()=>{const size=await widths();return size.chat===0&&size.work>=500&&size.files>=200&&await workspace.evaluate(el=>el.scrollWidth<=el.clientWidth+1);}).toBe(true);
 await page.getByLabel('Collapse sidebar').click();
 await expect.poll(async()=>{const size=await widths();return size.chat>=300&&size.work>=340&&size.files>=200&&await workspace.evaluate(el=>el.scrollWidth<=el.clientWidth+1);}).toBe(true);
 expect((await page.getByLabel('Toggle sidebar').boundingBox())!.x).toBeGreaterThanOrEqual(96);
 await page.getByLabel('Toggle sidebar').click();
 await expect.poll(async()=>{const size=await widths();return size.chat===0&&size.work>=500&&size.files>=200;}).toBe(true);
 await page.getByLabel('Close right sidebar').click();await page.getByLabel('Toggle files panel').click();
 await expect(conversation).toBeVisible();await expect.poll(async()=>(await conversation.boundingBox())!.width).toBeGreaterThan(600);
});

test('native titlebar drag targets keep the traffic-light lane and sidebar toggle separate',async({page,request})=>{
 await page.setViewportSize({width:1480,height:920});await bridge(page);await create(request,'Titlebar drag geometry');await ready(page);
 const dragAt=async(x:number,y:number)=>page.evaluate(([px,py])=>getComputedStyle(document.elementFromPoint(px,py)!).getPropertyValue('--wails-draggable').trim(),[x,y] as const);
 const collapse=page.getByLabel('Collapse sidebar');
 await expect.poll(async()=>Math.round((await collapse.boundingBox())!.x)).toBe(96);
 await expect.poll(()=>dragAt(111,22)).toBe('no-drag');
 await expect.poll(()=>dragAt(190,18)).toBe('drag');
 await expect.poll(()=>dragAt(350,18)).toBe('drag');
 await collapse.focus();
 await collapse.click();
 await expect.poll(async()=>Math.round((await page.getByLabel('Toggle sidebar').boundingBox())!.x)).toBe(96);
 await expect(page.getByLabel('Toggle sidebar')).toBeFocused();
 const toggle=(await page.getByLabel('Toggle sidebar').boundingBox())!;
 expect(await dragAt(toggle.x+toggle.width/2,toggle.y+toggle.height/2)).toBe('no-drag');
 await expect.poll(()=>dragAt(350,18)).toBe('drag');
 await page.getByLabel('Toggle sidebar').click();
 await expect(collapse).toBeFocused();
 await open(page,'Titlebar drag geometry');
 await expect.poll(()=>dragAt(390,18)).toBe('drag');
 await page.getByLabel('Collapse sidebar').click();
 await expect.poll(()=>dragAt(380,18)).toBe('drag');
 const composer=page.getByLabel('Session message');
 await composer.focus();
 await page.keyboard.press('Control+b');
 await expect(page.locator('.ade')).not.toHaveClass(/sidebar-collapsed/);
 await expect(composer).toBeFocused();
 await page.keyboard.press('Control+b');
 await expect(page.locator('.ade')).toHaveClass(/sidebar-collapsed/);
 await expect(composer).toBeFocused();
 await page.getByLabel('Toggle right sidebar').click();
 await page.getByLabel('Close right sidebar').click();
 await expect(composer).toBeFocused();
});
