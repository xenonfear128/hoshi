import { test, expect } from '@playwright/test';
import { fixture } from '../../web/e2e/fixtures';
import fs from 'node:fs';
for (const width of [390,1512]) for (const theme of ['dark','light']) {
 test(`audit ${width} ${theme}`, async ({page}) => {
 test.setTimeout(120000);
 await page.setViewportSize({width,height:width===390?844:1000});
 await fixture(page);
 if(theme==='light') await page.getByRole('button',{name:'切换主题',exact:true}).click();
 const prefix=`../design/ui-audit-2026-09-10/${width}-${theme}`;
 const metrics:any[]=[];
 async function snap(name:string) {
 await page.waitForTimeout(250);
 await page.screenshot({path:`${prefix}-${name}.png`,fullPage:true,animations:'disabled'});
 metrics.push({name,...await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth, text:[...document.querySelectorAll('h1,h2,h3,p,label,.small,.section-label,.nav button')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {text:e.textContent?.slice(0,90),font:s.fontFamily,size:s.fontSize,line:s.lineHeight,color:s.color,x:r.x,y:r.y,w:r.width,h:r.height}})}))});
 }
 const button=(name:string)=>page.getByRole('button',{name,exact:true});
 const close=()=>button('关闭').click();
 await snap('home');
 await button('添加主机').click(); await snap('host-new'); await close();
 await page.locator('.host-card button[title]').first().click(); await snap('host-edit'); await close();
 await button('AI 服务与订阅').click(); await snap('settings-byok');
 await button('平台订阅').click(); await snap('settings-subscription'); await close();
 await page.locator('.transfer-nav').click(); await snap('transfers'); await close();
 await button('AI 运维').click(); await snap('ai-empty');
 const task={id:'audit-task',hostId:'demo',request:'检查磁盘空间，找出日志占用最大的目录，先不要删除文件。',summary:'检查磁盘与日志目录占用，确认清理范围后再操作',status:'planned',steps:[{command:'df -h && du -sh /var/log/* | sort -h | tail -n 10',explanation:'查看磁盘容量及最大的日志目录',risk:'read'},{command:'sudo journalctl --vacuum-time=14d',explanation:'仅在确认日志保留要求后清理旧日志',risk:'write'}]};
 await page.route('**/api/ai/tasks',r=>r.fulfill({json:r.request().method()==='POST'?task:[task]}));
 await page.getByLabel('AI 目标主机').selectOption('demo');
 await page.getByLabel('运维需求').fill(task.request); await button('生成方案').click();
 await expect(page.locator('.plan')).toBeVisible(); await snap('ai-plan');
 await button('主机管理').click(); await button('连接').first().click();
 await expect(page.locator('.xterm-helper-textarea')).toBeAttached(); await snap('workspace');
 if(width===390) {await page.locator('.mobile-work-tabs').getByRole('button',{name:'监控',exact:true}).click();await snap('monitor');await page.locator('.mobile-work-tabs').getByRole('button',{name:'文件',exact:true}).click();}
 await snap('files');
 await button('production-config-with-a-long-readable-name.yaml').click(); await snap('file-editor'); await close();
 if(width===390) await page.locator('.mobile-work-tabs').getByRole('button',{name:'终端',exact:true}).click();
 await button('命令助手').click(); await snap('assistant');
 await page.getByRole('combobox',{name:'界面语言',exact:true}).selectOption('ja'); await snap('assistant-ja');
 await page.getByRole('combobox',{name:'表示言語',exact:true}).selectOption('en'); await snap('assistant-en');
 fs.writeFileSync(`${prefix}-metrics.json`,JSON.stringify(metrics,null,2));
 });
}
for(const width of [390,1512]) test(`login ${width}`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:1000});
 await page.route('**/api/me',r=>r.fulfill({status:401,json:{error:'login required'}}));
 await page.route('**/api/bootstrap',r=>r.fulfill({json:{registration:true}}));
 await page.goto('/');
 await page.screenshot({path:`../design/ui-audit-2026-09-10/${width}-login.png`,fullPage:true});
 await page.locator('.text-button').click();
 await page.screenshot({path:`../design/ui-audit-2026-09-10/${width}-register.png`,fullPage:true});
});
test('audit details and language lengths',async({page})=>{
 test.setTimeout(90000);
 const root='../design/ui-audit-2026-09-10';
 await fixture(page); await expect(page.locator('.host-card')).toHaveCount(2);
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const {root:doc}=await cdp.send('DOM.getDocument');const fonts:any={};
 for(const selector of ['h1','.host-card h3','.host-note']){const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:doc.nodeId,selector});fonts[selector]=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});}
 fs.writeFileSync(`${root}/rendered-fonts.json`,JSON.stringify(fonts,null,2));
 for(const width of [390,768]){
 await page.setViewportSize({width,height:width===390?844:1000});
 for(const locale of ['ja','en']){
 await page.locator('.nav .language-switcher select').selectOption(locale);
 await page.locator('.nav > button[aria-label]').first().click();
 await page.screenshot({path:`${root}/${width}-settings-${locale}.png`,fullPage:true});
 await page.locator('.modal > header button').click();
 }
 }
 await page.locator('.nav .language-switcher select').selectOption('zh-CN');
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'连接',exact:true}).first().click();
 await expect(page.locator('.xterm-helper-textarea')).toBeAttached();
 await page.locator('.mobile-work-tabs').getByRole('button',{name:'监控',exact:true}).click();
 await page.locator('.monitor').evaluate(e=>e.scrollTop=e.scrollHeight);
 await page.screenshot({path:`${root}/390-monitor-network.png`});
 await page.getByRole('button',{name:'主机管理',exact:true}).click();
 await page.route('**/api/hosts',r=>r.fulfill({json:[]}));await page.reload();
 await page.screenshot({path:`${root}/390-home-empty.png`});
 await page.getByRole('button',{name:'工作台',exact:true}).click();
 await page.screenshot({path:`${root}/390-workspace-empty.png`});
});
