import{c,u,l as f,m as y,n as a,t as p,s as t,x as A,z as o,B as n,E as i,C as l}from"./index-COCkkTru.js";const g={class:"inline-block font-extrabold align-middle"},h=c({__name:"ArmerButton",setup(x){const e=u(),m=()=>{o(async()=>l(e.arm),{command:"Arm"},n(i.ARM))},d=()=>{o(async()=>l(e.disarm),{command:"Disarm"},n(i.DISARM))};return(s,r)=>(f(),y("button",{class:"relative flex items-center justify-center w-32 p-1 rounded-md shadow-inner h-9 bg-slate-800/60",onClick:r[0]||(r[0]=b=>t(e).isArmed?d():m())},[a("div",{class:A(["absolute top-auto flex items-center px-1 rounded-[4px] shadow transition-all w-[70%] h-[80%]",t(e).isArmed===void 0?"justify-start bg-slate-800/60 text-slate-400 left-[4%]":t(e).isArmed?"bg-red-700 hover:bg-red-800 text-slate-50 justify-end left-[26%]":"bg-green-700 hover:bg-green-800 text-slate-400 justify-start left-[4%]"])},[a("span",g,p(t(e).isArmed===void 0?"...":t(e).isArmed?"Armed":"Disarmed"),1)],2)]))}});export{h as default};
