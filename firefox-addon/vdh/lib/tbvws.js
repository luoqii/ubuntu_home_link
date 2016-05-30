/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */

function DecodeVideoData(e,t){var r=null;if(t.forEach(function(e){if(!r)try{r=e.data.swfcfg.args}catch(t){}}),r){var o=[],n={videoId:e.videoId,title:r.title||_("video"),topUrl:e.topUrl,pageUrl:e.pageUrl,from:"tbvws",maxVariants:e.maxVariants,autoExec:e.autoExec,isPrivate:e.isPrivate};r.thumbnail_url&&(n.thumbnail=r.thumbnail_url),r.pageUrl&&(n.pageUrl=r.pageUrl),["url_encoded_fmt_stream_map","adaptive_fmts"].forEach(function(e){r[e]&&r[e].split(",").forEach(function(e){var t={};e.split("&").forEach(function(e){var r=PARAM_PATTERN.exec(e);r&&(t[decodeURIComponent(r[1])]=decodeURIComponent(r[2]))}),t.url&&o.push(t)})});var i=variants.getHitsFromVariants(n,o);i.forEach(function(e){listeners.forEach(function(t){t(e)})})}}function GetVideoMeta(e,t){var r={referer:e.baseUrl+"/results?search_query="+encodeURIComponent(e.title)};if(1==t){var o=[],n={SID:1,SSID:1,LOGIN_INFO:1},i=/https?:\/\/([^\/]+)/.exec(e.baseUrl);if(i){Cu["import"]("resource://gre/modules/Services.jsm");for(var a=Services.cookies.getCookiesFromHost(i[1]);a.hasMoreElements();){var s=a.getNext().QueryInterface(Ci.nsICookie);s.name in n&&o.push(s.name+"="+s.value)}r.cookie=o.join("; ")}}Request({url:e.baseUrl+"/watch?v="+e.videoId+"&spf=navigate",onComplete:function(r){if(r.json){simplePrefs.prefs["write-video-data-file"]&&utils.saveStringToFile("tbvws-"+e.videoId+"-"+(t||"0")+".json",JSON.stringify(r.json,null,4));var o=!1;Array.isArray(r.json)&&r.json.forEach(function(e){try{o=o||!!e.data.swfcfg.args}catch(t){}}),o?DecodeVideoData(e,r.json):t?1==t&&GetVideoMeta(e,2):GetVideoMeta(e,1)}},headers:r,anonymous:!!t}).get()}function UpdateDetection(){var e=simplePrefs.prefs["tbvws.enabled"];e&&!tbvwsPageMod?tbvwsPageMod=pageMod.PageMod({include:PM_PATTERN,contentScriptFile:self.data.url("tbvws-content.js"),contentScriptWhen:"start",onAttach:function(e){var t=null;e.port.on("detected-video",function(t){t.hasVideo&&(t.topUrl=e.tab.url,t.isPrivate=privateBrowsing.isPrivate(e),GetVideoMeta(t)),hits.updateCurrentUrl()}),e.port.on("selected-ids",function(r){t=e.tab.url,r.count>0?selectedIds[e.tab.url]={ids:r.ids,count:r.count}:delete selectedIds[e.tab.url]}),e.on("detach",function(){t&&delete selectedIds[t]})}}):!e&&tbvwsPageMod&&(tbvwsPageMod.destroy(),tbvwsPageMod=null)}function BulkDownload(e,t){var r=selectedIds[e];if(r&&!(r.count<1)||t){var o=/^(https?:\/\/[^\/]+)/.exec(e)[1],n=[];if(r&&(n=Object.keys(r.ids)),t){var i=/\bv=([^&]+)/.exec(t)[1];r&&r.ids[i]||n.push(i)}n.forEach(function(e){GetVideoMeta({baseUrl:o,videoId:e,title:e,topUrl:o+"/watch?v="+e,maxVariants:1,autoExec:"quickdownload"})})}}function UpdateContextMenus(){menus.appendMenuItem(merge({},baseContextMenu,{label:_("download-selected-links"),context:contextMenu.PredicateContext(function(e){var t=e.documentURL,r=e.linkURL?1:0;return t&&selectedIds[t]&&(r+=selectedIds[t].count),r>1})})),menus.appendMenuItem(merge({},baseContextMenu,{label:_("download-selected-link"),context:contextMenu.PredicateContext(function(e){var t=e.documentURL,r=e.linkURL?1:0;return t&&selectedIds[t]&&(r+=selectedIds[t].count),1==r})}))}function PurgeHookedVideos(){var e=Date.now();for(var t in hookedVideos)e>hookedVideos[t].expire&&delete hookedVideos[t]}const self=require("sdk/self"),$chrome=require("chrome"),Cc=$chrome.Cc,Ci=$chrome.Ci,Cu=$chrome.Cu,pageMod=require("sdk/page-mod"),Request=require("sdk/request").Request,simplePrefs=require("sdk/simple-prefs"),merge=require("sdk/util/object").merge,_=require("sdk/l10n").get,privateBrowsing=require("sdk/private-browsing"),contextMenu=require("sdk/context-menu"),timers=require("sdk/timers"),variants=require("./variants"),utils=require("./utils"),menus=require("./menus"),hits=require("./hits");var OS=null,encoder=null,listeners=[];const PARAM_PATTERN=new RegExp("^(.*?)=(.*)$"),TYPE_PATTERN=new RegExp("^([^/;]+)/(?:x-)?([^/;]+)"),PM_PATTERN=new RegExp("^https?://([^/]*.)?youtube(.co)?.([^./]+)/.*"),SIGN_PATTERN=new RegExp("[?&]signature="),ITAG_PATTERN=new RegExp("[?&]itag=([^&]+)"),ID_PATTERN=new RegExp("[?&]id=([^&]+)"),HV_PATTERN=new RegExp("^https?://([^/]*.)?googlevideo\\.");var hookedVideos={};exports.networkHook=function(e){if(!HV_PATTERN.test(e))return null;if(!SIGN_PATTERN.test(e))return null;var t=ITAG_PATTERN.exec(e);if(!t)return null;var r=t[1];if(t=ID_PATTERN.exec(e),!t)return null;var o=t[1],n=hookedVideos[o];if(!n){var i=variants.hasAudioVideo("tbvws:"+r);n=hookedVideos[o]={variants:{},audio:i.audio,video:i.video,expire:Date.now()+6e4}}return n.variants[r]?null:{id:o,itag:r,url:e,video:n}},exports.handleNetworkHook=function(e,t){var r=e.url,o=e.id,n=e.itag,i=e.video;if(m=/^.*?\?(.*)$/.exec(r),!m)return null;var a={};if(m[1].split("&").forEach(function(e){var t=/^(.*?)=(.*)$/.exec(e);t&&(a[t[1]]=t[2])}),i.variants[n]={url:r.replace(/(\?|&)range=[0-9]+\-[0-9]+&?/,"$1"),itag:n,type:decodeURIComponent(a.mime),clen:a.clen},/^audio/.test(a.mime)&&(i.audio=!0),/^video/.test(a.mime)&&(i.video=!0),i.audio&&i.video){var s=[];for(var d in i.variants)s.push(i.variants[d]);var u=variants.getHitsFromVariants({title:t.title,from:"tbvws",videoId:o,topUrl:t.topUrl,pageUrl:t.pageUrl,duration:a.dur?Math.round(a.dur):void 0},s,{audioAndVideo:!0,keepProtected:!0}),c=require("./converter").config();u.forEach(function(e){e._priorityClass="ready"!=c.status&&e.adp?-1:1,listeners.forEach(function(t){t(e)})})}};var selectedIds={},tbvwsPageMod=null;UpdateDetection(),simplePrefs.on("tbvws.enabled",UpdateDetection),exports.addListener=function(e){listeners.push(e)},exports.removeListener=function(e){var t=listeners.indexOf(e);t>=0&&listeners.splice(t,1)};var baseContextMenu={contentScript:'var contextHref = null;self.on("click", function() {  self.postMessage({ type: "click", url: window.location.href, contextHref: contextHref });});self.on("context",function(node) {  contextHref = null;  while(node && node.nodeType==Node.ELEMENT_NODE) {    if(node.tagName=="A") {      var href = node.getAttribute("href");      if(href && href.length>0 && /\\bv=[^&]+/.test(href))        contextHref = href;      break;    }    node = node.parentNode;  }  return true;});',onMessage:function(e){"click"==e.type&&BulkDownload(e.url,e.contextHref)}};UpdateContextMenus(),simplePrefs.on("context-menu",function(){timers.setTimeout(UpdateContextMenus,10)});var purgeTimer=timers.setInterval(PurgeHookedVideos,6e4);require("sdk/system/unload").when(function(){timers.clearInterval(purgeTimer)});