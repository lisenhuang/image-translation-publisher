'use client';
import {useEffect,useId,useRef} from 'react';
import {AlertCircle} from 'lucide-react';
import {useLanguage} from './Language';

export default function ErrorDialog({message,onDismiss,onRetry}){
 const {t}=useLanguage();
 const dialog=useRef(null),dismiss=useRef(null),titleId=useId(),messageId=useId();
 const open=Boolean(message);
 useEffect(()=>{
  if(!open)return;
  const element=dialog.current;
  element.showModal();
  dismiss.current?.focus({preventScroll:true});
  return()=>element.close();
 },[open]);
 return <dialog ref={dialog} className="error-modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId} onCancel={event=>{event.preventDefault();onDismiss();}}>
  <span className="error-modal-icon" aria-hidden="true"><AlertCircle size={25}/></span>
  <h2 id={titleId}>{t('请检查一下')}</h2>
  <p id={messageId}>{t(message)}</p>
  <div className="error-modal-actions">
   {onRetry&&<button type="button" className="button secondary" onClick={onRetry}>{t('重新加载')}</button>}
   <button ref={dismiss} type="button" className="button primary" onClick={onDismiss}>{t('知道了')}</button>
  </div>
 </dialog>;
}
