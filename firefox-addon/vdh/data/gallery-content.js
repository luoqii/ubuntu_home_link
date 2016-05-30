/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


var groups = {}

function MakeGroups(selector,type,options) {

	var nodes = document.querySelectorAll(selector);
	for(var i=0; i<nodes.length && (options.maxHits==0 || i<options.maxHits); i++) {
		var node=nodes.item(i);
		var href = null, keep=false;
		switch(type) {
		case 'link':
			href = node.getAttribute("href").trim();
			keep = true;
			break;
		case 'image':
			if(node.width && node.height && type=="image" && Math.min(node.width,node.height)>=options.minImgSize) {
				href = node.getAttribute("src").trim();
				keep = true;
			}
			break;
		case 'scrap':
			if(node.offsetWidth>=self.options.minAppletSize && node.offsetHeight>=self.options.minAppletSize)
				keep = true;
			break;
		}
		if(!keep)
			continue;
		var ancestors = [];
		var node0 = node;
		while(node0 && node0!=document) {
			ancestors.unshift(node0.nodeName.toLowerCase());
			node0 = node0.parentNode;
		}

		if(href) {
			var fileExtension = null
			if(href) {
				var m = /\.([^\.]{1,5})$/.exec(href);
				if(m)
					fileExtension = m[1].toLowerCase();
			}
			var key = HashCode(window.location.href+"@"+ancestors.join("/")+"@"+fileExtension);
			var attr = "vdh-"+key;
			var group = groups[key]; 
			if(!group) {
				group = groups[key] = {
					urlsMap: {},
					urls: [],
					baseUrl: window.location.href,
					extensions: {},
					selectorAttr: attr,
					type: type,
				} 
			}
			if(!group.urlsMap[href]) {
				if(node.firstChild && node.firstChild.nodeName.toLowerCase()=="img")
					node = node.firstChild;
				MakeMaskForNode(node,group.selectorAttr);
				group.urlsMap[href] = 1;
				group.urls.push(href);
				if(fileExtension) {
					var extension = group.extensions[fileExtension];
					if(extension)
						group.extensions[fileExtension]++;
					else
						group.extensions[fileExtension]=1;
				}
			}
		} else {
			var selector = GetUniqueSelector(node);//ancestors.join(" > ");
			var key = HashCode(window.location.href+"@"+selector+"@scrap");
			var attr = "vdh-"+key;
			MakeMaskForNode(node,attr);
			groups[key] = {
				baseUrl: window.location.href,
				selectorAttr: attr,
				selector: selector,
				type: type,
				size: node.offsetWidth + "x" + node.offsetHeight,
			}
		}
	}
}

function GetUniqueSelector(node) {
	var segments = [];
	while(node) {
		var segment = node.nodeName.toLowerCase();
		if(node.getAttribute && node.getAttribute("id"))
			segment+="#"+node.getAttribute("id");
		if(document.querySelectorAll(segments.concat([segment]).join(" > ")).length==1) {
			segments.push(segment);
			break;
		}
		var n=1;
		var node0 = node.prevSibling;
		while(node0) {
			if(node0.nodeName==node.nodeName)
				n++;
			node0 = node0.prevSibling;
		}
		segment+=":nth-of-type("+n+")";
		segments.push(segment);
		if(document.querySelectorAll(segments.concat([segment]).join(" > ")).length==1)
			break;
		node = node.parentNode;
	}
	return segments.join(" > ");
}

function MakeMaskForNode(node,attr) {
	var top = 0, left = 0, width = node.offsetWidth, height = node.offsetHeight;
	while(node) {
		top += node.offsetTop;
		left += node.offsetLeft;
		node = node.offsetParent;
	}
	node = document.createElement("div");
	node.setAttribute("style","width:"+width+"px;height:"+height+"px;top:"+top+"px;left:"+left+"px;display:none");
	node.setAttribute("class","vdh-mask "+attr);
	document.body.appendChild(node);
}


self.port.on("detect", function(message) {
	groups = {};
	var selectors = [];
	message.extensions.split("|").forEach(function(extension) {
		selectors.push("a[href$='"+extension+"']");
		selectors.push("a[href$='"+extension.toUpperCase()+"']");
	});
	MakeGroups(selectors.join(","),"link",message);
	if(message.scanImages)
		MakeGroups("img[src]","image",message);
	MakeGroups(message.scrapSelector,"scrap",message);
	
	var groupCount = 0;
	for(var gid in groups) {
		var group = groups[gid];
		if(group.urls && group.urls.length<message.minFilesPerGroup) {
			delete groups[gid];
			continue;
		}
		groupCount++;
	}
	if(groupCount>0)
		self.port.emit("detected",{
			groups: groups,
		});
});

function HashCode(str) {
	var hash=0, i, chr, len;
	if(str.length==0) 
		return hash;
	for(i=0, len = str.length; i < len; i++) {
		chr = str.charCodeAt(i);
		hash = ((hash << 5) - hash) + chr;
		hash |= 0;
	}
	return ""+Math.abs(hash);
};

