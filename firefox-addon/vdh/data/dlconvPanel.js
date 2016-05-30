/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


angular.module('VDH').controller('VDHDLConvCtrl', 
	['$scope', 'VDH.util',
	 	function($scope,VDHUtil) {
			$scope.values = {
				editingOutput: false,
			}
			$scope.currentConfigId = {
				value: null,
			}
			$scope.$watch("prefs['dlconv-last-output']", function(cci) {
				if(cci)
					$scope.currentConfigId.value = cci;				
			});
			$scope.$watch("currentConfigId.value",function(cci) {
				if(cci)
					$scope.prefs['dlconv-last-output'] = cci;
			});
			$scope.startEditor = function() {
				$scope.values.editingOutput=true;
			}
			$scope.formats = {};
			$scope.codecs = {};
			$scope.configs = {};
			$scope.storageDirectory = {
				value: "",
			};

			VDHUtil.prepareScope($scope);

			$scope.$watch("transientStorageDirectory || prefs['storagedirectory']",function(dir) {
				$scope.storageDirectory.value = dir || "";
			});

			$scope.$watch("converter",function(converter) {
				if(converter) {
					$scope.formats = converter.formats;
					$scope.codecs = converter.codecs;
					for(var f in $scope.configs)
						if($scope.configs.hasOwnProperty(f))
							delete $scope.configs[f];
					angular.extend($scope.configs,converter.configs);
				}
			},true);
			$scope.$watch("configs",function(configs) {
				if(configs && Object.keys(configs).length>0) {
					$scope.post("setConfigs",{ configs: configs });
				}
			},true);
			$scope.changeDirectory = function() {
				$scope.post("changeStorageDirectory",{});
			}
			$scope.saveTransientStorageDirectory = function() {
				$scope.prefs['storagedirectory'] = $scope.storageDirectory.value;
			}
			$scope.downloadOnly = function() {
				$scope.post("download",{});				
			}
			$scope.downloadAndConvert = function() {
				$scope.post("download",{
					config: $scope.currentConfigId.value,
				});				
			}
			$scope.convert = function() {
				$scope.post("convert",{
					config: $scope.currentConfigId.value,
				});				
			}
			$scope.assembleOnly = function() {
				$scope.post("assemble",{});				
			}
			$scope.assembleAndConvert = function() {
				$scope.post("assemble",{
					config: $scope.currentConfigId.value,
				});				
			}
			$scope.conversionHelp = function() {
				$scope.post("conversionHelp",{});				
			}
			$scope.configsArray = function() {
				var arr = [];
				if($scope.configs) {
					for(var id in $scope.configs) {
						var config = $scope.configs[id];
						config.id = id;
						arr.push(config)
						
					}
					arr.sort(function(a,b) {
						return a.title.toLowerCase()>b.title.toLowerCase()?1:-1;
					});
				}
				return arr;
			}
	}]);

