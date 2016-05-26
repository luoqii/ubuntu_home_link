/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */

function NewTweets() {
	var urlsMap = {};
	$("div[data-card-url]").each(function() {
		var activated = $(this).attr("vdh-activated");
		if(!activated) {
			$(this).attr("vdh-activated","1");
			urlsMap[$(this).attr("data-card-url")] = 1;
		}
	});
	var urls = Object.keys(urlsMap);
	if(urls.length>0)
		window.postMessage({
		    fromContent: true,
		    type: 'detected-links',
		    links: urls,
		},'*');

	var newTweetsBar = $(".new-tweets-bar");
	if(newTweetsBar.length==0)
		return;
	var newTweetsCount = parseInt(newTweetsBar.attr("data-item-count"));
	newTweetsBar.trigger('click');
}

setInterval(function() {
	NewTweets();
},1000);
