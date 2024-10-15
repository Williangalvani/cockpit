import{c as F,I as _,u as B,J as U,K as k,r as p,k as g,w as D,L as O,M as A,h as j,l as w,m as c,q as z,T as G,n as a,x as R,t as f,F as y,G as r,N as x,V as q,O as E,s,P as J,Q as K,R as L,S,U as Q,W as $}from"./index-COCkkTru.js";const H={class:"flex items-center w-[5.5rem] h-12 text-white justify-center"},X={class:"flex flex-col w-[4rem] select-none text-sm font-semibold leading-4 text-end"},Y={class:"w-full"},Z={class:"font-mono"},ee={class:"w-full"},te={class:"font-mono"},oe={class:"font-mono"},ae={class:"text-red-500 text-center text-sm w-[full]"},i=500,ne=F({__name:"BatteryIndicator",props:{miniWidget:{}},setup(C){const e=_(C).miniWidget,V={showCurrent:!0,showPower:!0,toggleInterval:1e3},o=B(),b=U(),M=k(),v=p(!0),d=p(void 0),m=p(""),h=p(void 0),l=p(e.value.options.toggleInterval??V.toggleInterval),T=g(()=>{var u;return((u=o==null?void 0:o.powerSupply)==null?void 0:u.voltage)===void 0?NaN:Math.abs(o.powerSupply.voltage)>=100?o.powerSupply.voltage.toFixed(0):o.powerSupply.voltage.toFixed(1)}),W=g(()=>{var u;return((u=o==null?void 0:o.powerSupply)==null?void 0:u.current)===void 0?NaN:Math.abs(o.powerSupply.current)>=100?o.powerSupply.current.toFixed(0):o.powerSupply.current.toFixed(1)}),N=g(()=>o.instantaneousWatts!==void 0?o.instantaneousWatts.toFixed(1):NaN),P=g(()=>"mdi-battery"),I=()=>{(d.value||h.value)&&(clearInterval(d.value),clearTimeout(h.value)),l.value<i?(e.value.options.toggleInterval=i,m.value=`Interval must be at least ${i}ms.`):e.value.options.toggleInterval=l.value,!e.value.options.showCurrent&&!e.value.options.showPower&&(e.value.options.showCurrent=!0,e.value.options.showPower=!0,m.value="At least one of the options must be enabled."),e.value.options.showCurrent&&e.value.options.showPower?d.value=setInterval(()=>{v.value=!v.value},e.value.options.toggleInterval):v.value=e.value.options.showCurrent,h.value=setTimeout(()=>{m.value="",l.value<i&&(l.value=i)},5e3)};return D([()=>e.value.options,l],I,{deep:!0}),O(()=>{e.value.options=Object.assign({},V,e.value.options),I(),A.registerUsage("Instantaneous Watts")}),j(()=>{d.value===void 0&&clearInterval(d.value)}),(u,t)=>(w(),c(y,null,[z((w(),c("div",H,[a("span",{class:R(["relative w-[1.5rem] mdi battery-icon",[P.value]])},t[4]||(t[4]=[a("span",{class:"absolute text-sm text-yellow-400 -bottom-[2px] -right-[7px] mdi mdi-alert-circle"},null,-1)]),2),a("div",X,[a("div",Y,[a("span",Z,f(T.value),1),t[5]||(t[5]=a("span",null," V",-1))]),a("div",ee,[v.value?(w(),c(y,{key:0},[a("span",te,f(W.value),1),t[6]||(t[6]=a("span",null," A",-1))],64)):(w(),c(y,{key:1},[a("span",oe,f(N.value),1),t[7]||(t[7]=a("span",null," W",-1))],64))])])])),[[G,"Battery information"]]),r($,{modelValue:s(b).miniWidgetManagerVars(s(e).hash).configMenuOpen,"onUpdate:modelValue":t[3]||(t[3]=n=>s(b).miniWidgetManagerVars(s(e).hash).configMenuOpen=n),width:"auto"},{default:x(()=>[r(q,{class:"pa-4 text-white w-[20rem]",style:E([{"border-radius":"15px"},s(M).globalGlassMenuStyles])},{default:x(()=>[r(J,{class:"text-center"},{default:x(()=>t[8]||(t[8]=[K("Battery Indicator Config")])),_:1}),r(L,{class:"flex flex-col gap-y-4"},{default:x(()=>[r(S,{modelValue:s(e).options.showCurrent,"onUpdate:modelValue":t[0]||(t[0]=n=>s(e).options.showCurrent=n),label:"Show Current","hide-details":""},null,8,["modelValue"]),r(S,{modelValue:s(e).options.showPower,"onUpdate:modelValue":t[1]||(t[1]=n=>s(e).options.showPower=n),label:"Show Power","hide-details":""},null,8,["modelValue"]),r(Q,{modelValue:l.value,"onUpdate:modelValue":t[2]||(t[2]=n=>l.value=n),modelModifiers:{number:!0},label:"Toggle Interval (ms)",type:"number",min:i,step:"100",density:"compact",variant:"outlined",disabled:!s(e).options.showCurrent||!s(e).options.showPower},null,8,["modelValue","disabled"]),a("p",ae,f(m.value),1)]),_:1})]),_:1},8,["style"])]),_:1},8,["modelValue"])],64))}});export{ne as default};
