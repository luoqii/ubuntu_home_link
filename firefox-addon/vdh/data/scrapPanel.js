/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


angular.module('VDH').controller('VDHScrapCtrl', 
	['$scope', 'VDH.util',
	 	function($scope,VDHUtil) {
			VDHUtil.prepareScope($scope);
			$scope.alignModes = [{
				mode: "cut",
				text: $scope._("scrap.8x8-align.cut"),
			},{
				mode: "extend",
				text: $scope._("scrap.8x8-align.extend"),
			}];
			$scope.mouseModes = [{
				mode: "never",
				text: $scope._("scrap.mouse.never"),
			},{
				mode: "always",
				text: $scope._("scrap.mouse.always"),
			},{
				mode: "metakey",
				text: $scope._("scrap.mouse.metakey"),
			},{
				mode: "not-metakey",
				text: $scope._("scrap.mouse.not-metakey"),
			}];
			$scope.data = {
				advanced: false,
			}
			$scope.start = function() {
				$scope.post("start",{ });
			}
			$scope.installConverter = function() {
				$scope.post("goto", { where: "converter" })
			}
			$scope.changeTarget = function() {
				$scope.post("save-as",{ });
			}

	}]);

