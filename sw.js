if(!self.define){let s,e={};const l=(l,i)=>(l=new URL(l+".js",i).href,e[l]||new Promise((e=>{if("document"in self){const s=document.createElement("script");s.src=l,s.onload=e,document.head.appendChild(s)}else s=l,importScripts(l),e()})).then((()=>{let s=e[l];if(!s)throw new Error(`Module ${l} didn’t register its module`);return s})));self.define=(i,r)=>{const n=s||("document"in self?document.currentScript.src:"")||location.href;if(e[n])return;let u={};const o=s=>l(s,n),t={module:{uri:n},exports:u,require:o};e[n]=Promise.all(i.map((s=>t[s]||o(s)))).then((s=>(r(...s),u)))}}define(["./workbox-3e911b1d"],(function(s){"use strict";self.skipWaiting(),s.clientsClaim(),s.precacheAndRoute([{url:"assets/Alerter-snYK-rGh.js",revision:null},{url:"assets/Alerter-ThpsFw6z.css",revision:null},{url:"assets/ArmerButton-BOzQI4sl.js",revision:null},{url:"assets/Attitude-CF6obvgw.js",revision:null},{url:"assets/Attitude-DSxIdVSk.css",revision:null},{url:"assets/BaseCommIndicator-DzCdnWhF.js",revision:null},{url:"assets/BatteryIndicator-CxbXQ62D.css",revision:null},{url:"assets/BatteryIndicator-fexq06dK.js",revision:null},{url:"assets/Button-BwZxbXkl.js",revision:null},{url:"assets/ChangeAltitudeCommander-Bf4IJNyc.js",revision:null},{url:"assets/Checkbox-CYhL9PYK.js",revision:null},{url:"assets/Clock-C4v2fFp8.js",revision:null},{url:"assets/Compass-DmuERlAR.js",revision:null},{url:"assets/Compass-Dqy1nyAf.css",revision:null},{url:"assets/CompassHUD-DJj_A026.css",revision:null},{url:"assets/CompassHUD-DJT6lig3.js",revision:null},{url:"assets/CustomWidgetBase-BlArdrH2.css",revision:null},{url:"assets/CustomWidgetBase-BYsDwH3-.js",revision:null},{url:"assets/DepthHUD-DFQRIQBm.css",revision:null},{url:"assets/DepthHUD-PloIRbKy.js",revision:null},{url:"assets/DepthIndicator-D28tljNb.js",revision:null},{url:"assets/Dial-BItVoeV8.css",revision:null},{url:"assets/Dial-Bup_O4_7.js",revision:null},{url:"assets/Dropdown-Bzu3FFfN.js",revision:null},{url:"assets/Dropdown-Dwl9TpjR.css",revision:null},{url:"assets/IFrame-C01BkrQj.js",revision:null},{url:"assets/IFrame-DXn0fOR_.css",revision:null},{url:"assets/ImageView-CpOLHCWC.css",revision:null},{url:"assets/ImageView-D7yBAn_-.js",revision:null},{url:"assets/index-DjKJqAo0.js",revision:null},{url:"assets/index-DxaGCbJO.js",revision:null},{url:"assets/index-n1j7qu3J.css",revision:null},{url:"assets/JoystickCommIndicator-Bzt5b35o.js",revision:null},{url:"assets/Label-DMxrmwiY.css",revision:null},{url:"assets/Label-f8H3Emvf.js",revision:null},{url:"assets/Map-BR0hP9uq.js",revision:null},{url:"assets/Map-tsyuNZ5O.css",revision:null},{url:"assets/MiniVideoRecorder-BGYhjRVX.js",revision:null},{url:"assets/MiniVideoRecorder-D8Qn6RBW.css",revision:null},{url:"assets/MiniWidgetsBar-DN1dfs1U.js",revision:null},{url:"assets/MissionIdentifier-ovKlRDLX.js",revision:null},{url:"assets/ModeSelector-UL-064RU.js",revision:null},{url:"assets/Plotter-Bzx9cY5E.js",revision:null},{url:"assets/Plotter-Dp4ni7mL.css",revision:null},{url:"assets/RelativeAltitudeIndicator-fPh26Q6u.js",revision:null},{url:"assets/SatelliteIndicator-B3Ss04ZO.js",revision:null},{url:"assets/Slider-DJBpBe5m.js",revision:null},{url:"assets/Slider-lgaFLsr-.css",revision:null},{url:"assets/Switch-CxbkKyzf.js",revision:null},{url:"assets/TakeoffLandCommander-CyKNQ3mz.js",revision:null},{url:"assets/URLVideoPlayer-B6V5zsl5.css",revision:null},{url:"assets/URLVideoPlayer-DZbJ9Y6v.js",revision:null},{url:"assets/VeryGenericIndicator-CWVFTxKH.css",revision:null},{url:"assets/VExpansionPanels-Ct6BiWLB.css",revision:null},{url:"assets/VExpansionPanels-DUNq9GDP.js",revision:null},{url:"assets/VideoPlayer-CZb5TcpC.css",revision:null},{url:"assets/VideoPlayer-CzRyFSEu.js",revision:null},{url:"assets/ViewSelector-B_rXds7f.js",revision:null},{url:"assets/VirtualHorizon-BAJY-cVd.css",revision:null},{url:"assets/VirtualHorizon-C1msu-bS.js",revision:null},{url:"assets/webfontloader--uHfAhjn.js",revision:null},{url:"electron/main.js",revision:"70976d17c853cafeec1a243f4ab7ef05"},{url:"electron/preload.js",revision:"662b2bb48d6302b6cb52bfb2aee33825"},{url:"index.html",revision:"586a800f1bb3f26220941d9c8a2abfa2"},{url:"registerSW.js",revision:"402b66900e731ca748771b6fc5e7a068"},{url:"favicon.ico",revision:"b54531a824aa22f592590e347be8347c"},{url:"apple-touch-icon.png",revision:"4d6428d260d0f769a26ed6ce0387d0c1"},{url:"manifest.webmanifest",revision:"a28c2c0a5d92b960e17dd3757933e534"}],{}),s.cleanupOutdatedCaches(),s.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("index.html")))}));