/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */



var url = window.location.href;

var scripts = document.querySelectorAll('script');
for(var i=0; i<scripts.length; i++) {
	var script = scripts[i];
	if(script.getAttribute("src"))
		continue;
	var nodeText = script.firstChild;
	if(!nodeText)
		continue;
	var m = /buildPlayer\((.*)\);/.exec(nodeText.nodeValue);
	if(!m)
		m = /window\.playerV5 *=.*?,(.*)\);/.exec(nodeText.nodeValue);
	if(!m)
		continue;
	try {
		var data = JSON.parse(m[1]);
		var videoMessage = {
			pageUrl: url,
			source: url,
			videoId: data.metadata.id,
			hasVideo: true,
			data: data.metadata,
		}
		self.port.emit("detected-video",videoMessage);
		break;
	} catch($_) {};

}