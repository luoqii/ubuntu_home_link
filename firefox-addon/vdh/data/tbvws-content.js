/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


var url = null, videoId = null;

//console.info("DWHELPER content file loaded");

function CheckURLChange() {
	if(url==window.location.href)
		return;
	url=window.location.href;
	function GetVideoId() {
		var m = /[\?&]v=([a-zA-Z0-9\-_]+)/.exec(url);
		if(m)
			return m[1];
		m = /\/embed\/([a-zA-Z0-9\-_]+)/.exec(url);
		if(m)
			return m[1];
		return null;
	}

	videoId = GetVideoId();

	var videoMessage = {
		pageUrl: url,
	}

	//console.info("DWHELPER url",url,"id",videoId);

	if(videoId) {
		videoMessage.videoId = videoId;
		videoMessage.source = url;
		var m = /^(https?:\/\/(?:[^\/]*\.)?\x79\x6f\x75\x74\x75\x62\x65(?:\.co)?\.(?:[^\.\/]+))\//.exec(url);
		if(m)
			videoMessage.baseUrl = m[1];
	}

	videoMessage.hasVideo = !!videoId;

	self.port.emit("detected-video",videoMessage);
}
CheckURLChange();
window.setInterval(CheckURLChange,500);

var LINK_PATTERN = new RegExp("\\bv=([^&]+)");

var totalCheckSelectionTime = 0;

function CheckSelection() {
	var t0 = Date.now();

	var selection=window.getSelection();
	if(!selection)
		return;
	
	var ids = {};
	for(var ri=0;ri<selection.rangeCount;ri++) {
		var range=selection.getRangeAt(ri);
		if(!range.collapsed && range.commonAncestorContainer.getElementsByTagName) {
			var aNodes = range.commonAncestorContainer.getElementsByTagName("a");
			for(var i=0; i<aNodes.length; i++) {
				var node = aNodes[i];
				if(selection.containsNode(node, true)) {
					var href = node.getAttribute("href");
					if(href && href.length>0) {
						var m = LINK_PATTERN.exec(href);
						if(m && m[1]!=videoId)
							ids[m[1]] = 1;
					}
				}
			}
			
		}
	}

	var idsCount = 0;
	for(var id in ids)
		idsCount++;
	
	self.port.emit("selected-ids",{
		ids: ids,
		count: idsCount,
	});
}

window.addEventListener('mouseup',function(event) {
	if(event.which!=1)
		return;
	window.setTimeout(CheckSelection,10);
});