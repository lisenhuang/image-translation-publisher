import test from 'node:test';
import assert from 'node:assert/strict';
import {cookieLanguage,languageForRequest,resolveLanguage,translate} from '../lib/i18n.mjs';
test('system language defaults and remembered overrides support only English and Simplified Chinese',()=>{
 for(const system of ['zh','zh-CN','zh-TW','zh-HK','zh-Hant','zh-Hant-TW','zh-SG','ZH-hans'])assert.equal(resolveLanguage(null,system),'zh-CN');
 for(const system of ['', 'en-US','en-NZ','ja-JP','fr-FR','ko-KR','*'])assert.equal(resolveLanguage(null,system),'en');
 assert.equal(resolveLanguage(null,'zh-TW,zh;q=0.9,en;q=0.8'),'zh-CN');
 assert.equal(resolveLanguage(null,'en-NZ,zh-CN;q=0.9'),'en');
 assert.equal(resolveLanguage(null,'zh;q=0,en;q=0.9'),'en');
 assert.equal(resolveLanguage('en','zh-TW'),'en');assert.equal(resolveLanguage('zh-CN','en-US'),'zh-CN');
 assert.equal(resolveLanguage('fr','zh-Hant'),'zh-CN');
 assert.equal(cookieLanguage('hb_session=private; hb_lang=zh-CN'),'zh-CN');
 assert.equal(languageForRequest(new Request('https://example.test',{headers:{'accept-language':'zh-TW'}})),'zh-CN');
 assert.equal(languageForRequest(new Request('https://example.test',{headers:{cookie:'hb_lang=en','accept-language':'zh-CN'}})),'en');
 assert.equal(languageForRequest(new Request('https://example.test',{headers:{'x-hooboo-language':'zh-CN',cookie:'hb_lang=en'}})),'zh-CN');
});
test('labels, API errors, dynamic notices and original content have consistent translations',()=>{
 assert.equal(translate('投稿工作台','en'),'Contributor workspace');
 assert.equal(translate('账号或密码不正确。','en'),'The username or password is incorrect.');
 assert.equal(translate('The username or password is incorrect.','zh-CN'),'账号或密码不正确。');
 assert.equal(translate('原稿预览 ','en'),'Original preview ');
 assert.equal(translate('发布成功。公开地址：/article/123','en'),'Published. Public address: /article/123');
 assert.equal(translate('Published. Public address: /article/123','zh-CN'),'发布成功。公开地址：/article/123');
 assert.equal(translate('续期失败：处理任务已过期，请重新领取。','en'),'Lease renewal failed: The processing task expired. Claim it again.');
 assert.equal(translate('用户的原创标题','en'),'用户的原创标题');
});
