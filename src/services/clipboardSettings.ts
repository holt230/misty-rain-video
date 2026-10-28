import { ref } from 'vue';
const key='misty_rain_clipboard_detection';
const initial=()=>{try{return localStorage.getItem(key)!=='off';}catch{return true;}};
export const clipboardDetection=ref(initial());
export const setClipboardDetection=(enabled:boolean)=>{
 clipboardDetection.value=enabled;
 try{localStorage.setItem(key,enabled?'on':'off');}catch{/* Session preference remains usable. */}
 if(enabled)window.dispatchEvent(new Event('misty-clipboard-check'));
};
