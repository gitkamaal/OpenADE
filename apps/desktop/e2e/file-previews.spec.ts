import {test,create,ready,open,daemon,status} from './helpers';
import {expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const png=fs.readFileSync(new URL('./fixtures/preview-grid.png',import.meta.url));

test('files search follows source keyboard reveal and the eye controls hidden and ignored entries',async({page,request})=>{
 const session=await create(request,'Source file explorer controls');await expect.poll(()=>status(request,session.id)).toBe('completed');
 fs.mkdirSync(path.join(session.worktree_path,'src'),{recursive:true});
 fs.writeFileSync(path.join(session.worktree_path,'src','zebra-quick-xylophone.md'),'# Search target\n');
 fs.writeFileSync(path.join(session.worktree_path,'.hidden-note.md'),'hidden\n');
 fs.writeFileSync(path.join(session.worktree_path,'.gitignore'),'ignored-secret.tmp\n');
 fs.writeFileSync(path.join(session.worktree_path,'ignored-secret.tmp'),'ignored\n');
 await ready(page);await open(page,'Source file explorer controls');await page.getByLabel('Toggle files panel').click();
 const tree=page.getByRole('tree',{name:'Project files'});
 await expect(tree.getByRole('treeitem',{name:'.hidden-note.md',exact:true})).toHaveCount(0);
 await expect(tree.getByRole('treeitem',{name:'ignored-secret.tmp',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Show all files (even hidden)'}).click();
 await expect(page.getByRole('button',{name:'Hide hidden and ignored files'})).toHaveAttribute('aria-pressed','true');
 await expect(tree.getByRole('treeitem',{name:'.hidden-note.md',exact:true})).toBeVisible();
 await expect(tree.getByRole('treeitem',{name:'ignored-secret.tmp',exact:true})).toBeVisible();
 const search=page.getByRole('searchbox',{name:'Search files'});await search.fill('zqx');
 const results=page.getByRole('tree',{name:'Fuzzy workspace file results'});
 await expect(results.getByRole('treeitem',{name:'src',exact:true})).toHaveAttribute('aria-expanded','true');
 await expect(results.getByRole('treeitem',{name:'src/zebra-quick-xylophone.md'})).toBeVisible();
 await search.press('ArrowDown');await expect(search).toHaveAttribute('aria-activedescendant','file-search-result-1');
 await search.press('Enter');await expect(search).toHaveValue('');
 await expect(page.getByRole('tab',{name:'zebra-quick-xylophone.md'})).toHaveAttribute('aria-selected','true');
 await expect(tree.getByRole('treeitem',{name:'src/zebra-quick-xylophone.md'})).toBeVisible();
 await search.fill('zqx');await search.press('Escape');await expect(search).toHaveValue('');await expect(tree).toBeFocused();
 await page.keyboard.press('ArrowUp');await expect(tree.getByRole('treeitem',{name:'src',exact:true})).toHaveAttribute('aria-selected','true');
 await tree.press('ArrowLeft');await expect(tree.getByRole('treeitem',{name:'src',exact:true})).toHaveAttribute('aria-expanded','false');
 await tree.press('ArrowRight');await expect(tree.getByRole('treeitem',{name:'src',exact:true})).toHaveAttribute('aria-expanded','true');
 await tree.press('ArrowRight');await expect(tree.getByRole('treeitem',{name:'src/zebra-quick-xylophone.md'})).toHaveAttribute('aria-selected','true');
 await page.getByRole('button',{name:'Hide hidden and ignored files'}).click();
 await expect(tree.getByRole('treeitem',{name:'.hidden-note.md',exact:true})).toHaveCount(0);
 await expect(tree.getByRole('treeitem',{name:'ignored-secret.tmp',exact:true})).toHaveCount(0);
});

test('large file tree keeps rendered rows bounded and reveals the end on scroll',async({page,request})=>{
 const session=await create(request,'Large source file tree');await expect.poll(()=>status(request,session.id)).toBe('completed');
 for(let index=0;index<1200;index++)fs.writeFileSync(path.join(session.worktree_path,`file-${String(index).padStart(4,'0')}.md`),'# Fixture\n');
 await ready(page);await open(page,'Large source file tree');await page.getByLabel('Toggle files panel').click();
 const tree=page.getByRole('tree',{name:'Project files'});
 await expect(tree.getByRole('treeitem',{name:'file-0000.md',exact:true})).toBeVisible();
 await expect.poll(()=>tree.getByRole('treeitem').count()).toBeLessThan(250);
 await tree.evaluate(element=>{element.scrollTop=element.scrollHeight;element.dispatchEvent(new Event('scroll',{bubbles:true}));});
 await expect(tree.getByRole('treeitem',{name:'file-1199.md',exact:true})).toBeVisible();
 await tree.evaluate(element=>{element.scrollTop=0;element.dispatchEvent(new Event('scroll',{bubbles:true}));});
 await expect(tree.getByRole('treeitem',{name:'file-0000.md',exact:true})).toBeVisible();
 await expect(tree.getByRole('treeitem',{name:'file-1199.md',exact:true})).toHaveCount(0);
 await page.evaluate(()=>{window.requestAnimationFrame=()=>0;});
 await tree.evaluate(element=>{element.scrollTop=element.scrollHeight;element.dispatchEvent(new Event('scroll',{bubbles:true}));});
 await expect(tree.getByRole('treeitem',{name:'file-1199.md',exact:true})).toBeVisible();
});

test('reopening files reads external changes without polling a hidden panel',async({page,request})=>{
 const session=await create(request,'External file refresh');await expect.poll(()=>status(request,session.id)).toBe('completed');
 await ready(page);await open(page,'External file refresh');await page.getByLabel('Toggle files panel').click();
 const tree=page.getByRole('tree',{name:'Project files'});await expect(tree.getByRole('treeitem',{name:'README.md',exact:true})).toBeVisible();
 fs.writeFileSync(path.join(session.worktree_path,'outside-change.md'),'# Added elsewhere\n');
 await expect(tree.getByRole('treeitem',{name:'outside-change.md',exact:true})).toHaveCount(0);
 await page.getByLabel('Toggle files panel').click();await page.getByLabel('Toggle files panel').click();
 await expect(tree.getByRole('treeitem',{name:'outside-change.md',exact:true})).toBeVisible();
});

test('files tree uses the pinned source icon identities and loads their native assets',async({page,request})=>{
 const session=await create(request,'File identity icons');await expect.poll(()=>status(request,session.id)).toBe('completed');
 fs.mkdirSync(path.join(session.worktree_path,'src'),{recursive:true});
 fs.writeFileSync(path.join(session.worktree_path,'src','component.test.tsx'),'export const ready = true;\n');
 await ready(page);await open(page,'File identity icons');await page.getByLabel('Toggle files panel').click();
 const tree=page.getByRole('tree',{name:'Project files'}),folder=tree.getByRole('treeitem',{name:'src',exact:true});
 await expect(folder.locator('img')).toHaveAttribute('src',/file-icons\/dark\/folders\/folder-orange-code\.svg$/);
 await folder.click();
 const file=tree.getByRole('treeitem',{name:'src/component.test.tsx',exact:true});
 await expect(file.locator('img')).toHaveAttribute('src',/file-icons\/dark\/files\/react-test\.svg$/);
 await expect.poll(()=>file.locator('img').evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
 await file.click();
 await expect(page.getByRole('tab',{name:'component.test.tsx'}).locator('img')).toHaveAttribute('src',/file-icons\/dark\/files\/react-test\.svg$/);
});

test('chat switching restores the selected file tab and reloads its saved Markdown preview',async({page,request})=>{
 const first=await create(request,'File owner first',{agent:'shell',prompt:'printf first'});
 const second=await create(request,'File owner second',{agent:'shell',prompt:'printf second'});
 await expect.poll(()=>status(request,first.id)).toBe('completed');await expect.poll(()=>status(request,second.id)).toBe('completed');
 const file=path.join(first.worktree_path,'retained.md');fs.writeFileSync(file,'# Original file\n');
 await ready(page);await open(page,'File owner first');await page.getByLabel('Toggle files panel').click();
 await page.getByRole('treeitem',{name:'retained.md',exact:true}).click();await expect(page.getByRole('tab',{name:'retained.md',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByLabel('Preview Markdown').click();await expect(page.locator('.file-markdown-preview')).toContainText('Original file');
 await open(page,'File owner second');fs.writeFileSync(file,'# Updated while away\n');await open(page,'File owner first');
 await expect(page.getByRole('tab',{name:'retained.md',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.locator('.file-markdown-preview')).toContainText('Updated while away');
 await expect(page.getByRole('treeitem',{name:'retained.md',exact:true})).toHaveClass(/active/);
});

test('macOS AVIF and HEIC workspace files render as bounded authenticated PNG previews',async({page,request})=>{
 const session=await create(request,'Native codec file previews');await expect.poll(()=>status(request,session.id)).toBe('completed');
 for(const name of ['media-grid.avif','media-grid.heic'])fs.copyFileSync(new URL(`./fixtures/${name}`,import.meta.url),path.join(session.worktree_path,name));
 await ready(page);await open(page,'Native codec file previews');await page.getByLabel('Toggle files panel').click();
 for(const name of ['media-grid.avif','media-grid.heic']){
  const response=await request.get(`${daemon}/api/sessions/${session.id}/file-media?path=${name}`);expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('image/png');expect((await response.body()).subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
  await page.getByRole('treeitem',{name,exact:true}).click();const viewport=page.getByRole('region',{name:`${name} image viewport`});await expect(viewport).toBeVisible();await expect.poll(()=>viewport.locator('img').evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBe(6);
 }
 fs.writeFileSync(path.join(session.worktree_path,'spoofed.avif'),png);expect((await request.get(`${daemon}/api/sessions/${session.id}/file-media?path=spoofed.avif`)).status()).toBe(400);
});

test('static SVG previews render while scripts, HTML, links and external resources are removed',async({page,request})=>{
 const session=await create(request,'Safe SVG file preview');await expect.poll(()=>status(request,session.id)).toBe('completed');
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120"><defs><linearGradient id="shade"><stop offset="0" stop-color="#187ec8"/><stop offset="1" stop-color="#4dcc9b"/></linearGradient></defs><rect width="240" height="120" fill="url(#shade)" onload="alert(1)"/><text x="12" y="64" font-size="22" fill="white">Safe vector</text><circle cx="20" cy="20" r="8" fill="red" style="fill:#f3c452"/><script>alert(2)</script><foreignObject width="50" height="50"><div xmlns="http://www.w3.org/1999/xhtml">Unsafe HTML</div></foreignObject><image href="https://example.invalid/private" width="20" height="20"/><a href="file:///etc/passwd"><circle cx="12" cy="12" r="8"/></a></svg>';
 fs.writeFileSync(path.join(session.worktree_path,'safe.svg'),svg);
 fs.writeFileSync(path.join(session.worktree_path,'vector.md'),'# Vector\n\n![Safe vector](safe.svg)\n');
 const media=`${daemon}/api/sessions/${session.id}/file-media?path=`;
 const response=await request.get(media+'safe.svg');expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('image/svg+xml');expect(response.headers()['cache-control']).toContain('no-store');
 const prepared=await response.text();expect(prepared).toContain('Safe vector');expect(prepared).toContain('url(#shade)');expect(prepared).toContain('fill="#f3c452"');expect(prepared).not.toContain('fill="red"');for(const unsafe of ['<script','<foreignObject','<image','<a ','onload','example.invalid','file:///etc/passwd','Unsafe HTML','alert(2)'])expect(prepared).not.toContain(unsafe);
 await ready(page);await open(page,'Safe SVG file preview');await page.getByLabel('Toggle files panel').click();await page.getByRole('treeitem',{name:'safe.svg',exact:true}).click();
 const viewport=page.getByRole('region',{name:'safe.svg image viewport'});await expect(viewport).toBeVisible();await expect.poll(()=>viewport.locator('img').evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBe(240);await expect(page.getByLabel('Save file',{exact:true})).toBeDisabled();
 await page.getByRole('treeitem',{name:'vector.md',exact:true}).click();await page.getByLabel('Preview Markdown').click();await expect.poll(()=>page.getByLabel('View Safe vector').locator('img').evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBe(240);
 fs.writeFileSync(path.join(session.worktree_path,'doctype.svg'),'<!DOCTYPE svg [<!ENTITY hidden SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
 fs.writeFileSync(path.join(session.worktree_path,'huge.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="99999" height="10"/>');
 fs.writeFileSync(path.join(session.worktree_path,'external.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="u\\72l(https://example.invalid/private)"/></svg>');
 for(const name of ['doctype.svg','huge.svg'])expect((await request.get(media+name)).status()).toBe(400);
 const escaped=await request.get(media+'external.svg');expect(escaped.status()).toBe(200);expect(await escaped.text()).not.toContain('example.invalid');
});

test('workspace WebP, BMP and TIFF files render through authenticated image media',async({page,request})=>{
 const session=await create(request,'Raster file preview formats');await expect.poll(()=>status(request,session.id)).toBe('completed');
 for(const name of ['media-grid.webp','media-grid.bmp','media-grid.tif'])fs.copyFileSync(new URL(`./fixtures/${name}`,import.meta.url),path.join(session.worktree_path,name));
 await ready(page);await open(page,'Raster file preview formats');await page.getByLabel('Toggle files panel').click();
 for(const name of ['media-grid.webp','media-grid.bmp','media-grid.tif']){
  const response=await request.get(`${daemon}/api/sessions/${session.id}/file-media?path=${name}`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain(name.endsWith('.webp')?'image/webp':'image/png');
  await page.getByRole('treeitem',{name,exact:true}).click();
  const viewport=page.getByRole('region',{name:`${name} image viewport`});
  await expect(viewport).toBeVisible();
  await expect.poll(()=>viewport.locator('img').evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBe(3);
  await expect(page.getByLabel('Save file',{exact:true})).toBeDisabled();
  if(name.endsWith('.tif')){
   fs.copyFileSync(new URL('./fixtures/media-grid-updated.tif',import.meta.url),path.join(session.worktree_path,name));
   await page.getByLabel('Reload file').click();
   await expect.poll(()=>viewport.locator('img').evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBe(6);
  }
 }
});

test('workspace image preview zooms and pans locally, Markdown preview preserves edits and undo',async({page,request})=>{
 const session=await create(request,'File preview parity audit');await expect.poll(()=>status(request,session.id)).toBe('completed');
 fs.mkdirSync(path.join(session.worktree_path,'docs'));fs.writeFileSync(path.join(session.worktree_path,'docs/grid.png'),png);fs.writeFileSync(path.join(session.worktree_path,'docs/guide.md'),'# Preview guide\n\n**This deliberately long emphasized description must wrap naturally in a narrow Markdown preview instead of inheriting the editor filename ellipsis and clipping the rest of its sentence.**\n\n![Workspace image](grid.png)\n\n![Outside image](../../outside.png)\n');
 await ready(page);await open(page,'File preview parity audit');await page.getByLabel('Toggle files panel').click();await page.getByRole('treeitem',{name:'docs',exact:true}).click();await page.getByRole('treeitem',{name:'docs/grid.png',exact:true}).click();
 const viewport=page.getByRole('region',{name:'grid.png image viewport'});await expect(viewport).toBeVisible();await expect.poll(()=>viewport.locator('img').evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBe(1200);expect(await page.getByLabel('Save file',{exact:true}).isEnabled()).toBe(false);
 await expect.poll(()=>viewport.evaluate(node=>node.clientWidth)).toBeGreaterThan(300);await expect.poll(()=>viewport.evaluate(node=>Math.abs(Number(node.getAttribute('data-scale'))-Math.min(node.clientWidth/1200,node.clientHeight/900,1)))).toBeLessThan(.002);const fitted=Number(await viewport.getAttribute('data-scale'));await viewport.evaluate(node=>{const r=node.getBoundingClientRect();node.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-500,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));});await expect.poll(async()=>Number(await viewport.getAttribute('data-scale'))).toBeGreaterThan(fitted);
 const box=(await viewport.boundingBox())!;const before=await viewport.locator('img').evaluate(node=>(node as HTMLElement).style.left);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2+40);await page.mouse.up();expect(await viewport.locator('img').evaluate(node=>(node as HTMLElement).style.left)).not.toBe(before);
 await viewport.focus();await page.keyboard.press('0');await expect.poll(()=>viewport.evaluate(node=>Math.abs(Number(node.getAttribute('data-scale'))-Math.min(node.clientWidth/1200,node.clientHeight/900,1)))).toBeLessThan(.002);
 await page.getByRole('treeitem',{name:'docs/guide.md',exact:true}).click();const editor=page.getByRole('textbox',{name:'Edit docs/guide.md',exact:true});await editor.focus();await page.keyboard.press(process.platform==='darwin'?'Meta+End':'Control+End');await page.keyboard.type('\nUnsaved preview text');
 await page.getByLabel('Preview Markdown',{exact:true}).click();await expect(page.locator('.file-markdown-preview')).toContainText('Unsaved preview text');await expect(page.locator('.file-markdown-preview strong')).toHaveCSS('white-space','normal');expect(await page.locator('.file-markdown-preview strong').evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);return range.getClientRects().length;})).toBeGreaterThan(1);await expect(page.getByText('Image unavailable: Outside image')).toBeVisible();const image=page.getByLabel('View Workspace image');await expect.poll(()=>image.locator('img').evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBe(1200);await image.click();await expect(page.getByRole('dialog',{name:'Workspace image',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(image).toBeFocused();
 await page.getByLabel('Edit Markdown',{exact:true}).click();await expect(editor).toContainText('Unsaved preview text');await editor.focus();await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');await expect(editor).not.toContainText('Unsaved preview text');
});

test('file media endpoint rejects traversal, links, non-images and unauthenticated access',async({request,page})=>{
 const session=await create(request,'File media boundaries');fs.writeFileSync(path.join(session.worktree_path,'grid.png'),png);fs.symlinkSync(path.join(session.worktree_path,'grid.png'),path.join(session.worktree_path,'link.png'));fs.writeFileSync(path.join(session.worktree_path,'unsafe.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
 const media=`${daemon}/api/sessions/${session.id}/file-media?path=`;const response=await request.get(media+'grid.png');expect(response.status()).toBe(200);expect(await response.body()).toEqual(png);
 for(const file of ['../grid.png','link.png','README.md','unsafe.svg','.git/config'])expect((await request.get(media+encodeURIComponent(file))).status()).toBeGreaterThanOrEqual(400);
 expect((await page.request.get(media+'grid.png')).status()).toBe(401);
});
