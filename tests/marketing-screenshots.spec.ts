import { _electron, expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('captures public product screenshots with demo-only content', async () => {
  const testRoot=await fs.mkdtemp(path.join(os.tmpdir(),'markdown-magic-public-demo-'));
  const userDataDirectory=path.join(testRoot,'user-data');
  const documentRoot=path.join(testRoot,'Markdown Magic Demo');
  await fs.mkdir(userDataDirectory,{recursive:true}); await fs.mkdir(documentRoot,{recursive:true});
  const welcomePath=path.join(documentRoot,'Welcome.md'); const guidePath=path.join(documentRoot,'Writing Guide.md'); const releasePath=path.join(documentRoot,'Release Notes.md');
  await fs.writeFile(welcomePath,`# A calmer way to work with Markdown

Markdown Magic keeps local files at the center of your writing workflow.

## One document, one clear surface

Write formatted content directly without switching between source and preview. Headings, lists, quotes, links, images, tables, and code remain familiar Markdown on disk.

> Your folder stays the source of truth.

## Built for everyday work

- Open an existing folder from your Mac
- Keep related files together in compact tab groups
- Switch between continuous editing and page review
- Zoom the document without scaling the interface
- Review external changes before replacing your work

## Local by default

There is no proprietary document format. Your files remain readable in any editor and easy to back up with the tools you already use.
`,'utf8');
  await fs.writeFile(guidePath,`# Writing Guide

## Start with the answer

Give each section one clear purpose. Short paragraphs make long documents easier to scan and simpler to revise.

## Keep the structure visible

Use descriptive headings, concise lists, and tables only when comparison matters.

## Review as pages

Page view helps find dense passages, awkward breaks, and tables that need more room before publication.
`,'utf8');
  await fs.writeFile(releasePath,`# Release Notes

## Markdown Magic 0.1.4

This beta focuses on a calmer, more reliable desktop workflow.

### Editing

- Visual Markdown editing with local file persistence
- Continuous and multi-page document views
- Document zoom from 50 to 300 percent
- Better wrapping for long links and code

### Organization

- Finder-like navigation and search
- Multiple files in tabs and named groups
- A compact focus mode that fully collapses navigation

### Safety

- Version history before important changes
- Clear handling for moved or externally edited files
- Reviewable assistant suggestions with undo

## Supported files

Markdown Magic opens Markdown, plain text, data, configuration, web, and common source-code files. Everything stays in the folder you selected.

## What comes next

The next public release will focus on Apple notarization, streamlined onboarding, and broader compatibility testing.
`,'utf8');
  const groupId='group-product';
  const tabs=[welcomePath,guidePath,releasePath].map((filePath)=>({id:`tab-${encodeURIComponent(filePath)}`,path:filePath,title:path.basename(filePath),groupId,dirty:false,missing:false}));
  await fs.writeFile(path.join(userDataDirectory,'workspace-state.json'),JSON.stringify({version:1,rootPath:documentRoot,groups:[{id:groupId,name:'Product',description:'',icon:'M',color:'blue',collapsed:false}],tabs,activeTabId:tabs[0]!.id},null,2),'utf8');
  await fs.writeFile(path.join(userDataDirectory,'onboarding-complete'),'1','utf8');
  const electronApp=await _electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,MARKDOWN_MAGIC_USER_DATA_DIR:userDataDirectory}});
  const window=await electronApp.firstWindow(); await window.evaluate(()=>globalThis.resizeTo(1440,900));
  await expect(window.locator('.ProseMirror h1')).toContainText('A calmer way'); await window.screenshot({path:'docs/screenshots/workspace-light.png'});
  await window.locator('.tab',{hasText:'Release Notes.md'}).click(); await expect(window.locator('.ProseMirror h1')).toContainText('Release Notes');
  await window.locator('[data-view-mode="pages"]').click(); await window.locator('[data-page-columns="2"]').click(); await expect(window.locator('.page-preview-grid')).toHaveAttribute('data-page-columns','2');
  await window.screenshot({path:'docs/screenshots/pages-light.png'});
  await window.evaluate(()=>localStorage.setItem('markdown-magic:theme','dark')); await window.reload(); await expect(window.locator('body')).toHaveAttribute('data-theme','dark');
  await window.locator('[data-view-mode="flow"]').click(); await window.locator('[data-action="toggle-sidebar"]').click(); await expect(window.locator('#app')).toHaveClass(/sidebar-collapsed/);
  await window.screenshot({path:'docs/screenshots/focus-dark.png'}); await electronApp.close();
});
