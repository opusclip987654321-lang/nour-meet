import jsQR from "jsqr";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { Layout } from "../../components/Layout";
import { AdminNav } from "./AdminNav";

export function Scanner() {
  const [code,setCode]=useState("");
  const [result,setResult]=useState<any>(null);
  const [error,setError]=useState("");
  const [cameraError,setCameraError]=useState("");
  const [scanning,setScanning]=useState(false);
  const videoRef=useRef<HTMLVideoElement>(null);
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const rafRef=useRef<number|null>(null);
  const lastScanRef=useRef<{code:string;at:number}>({code:"",at:0});
  const busyRef=useRef(false);

  const runScan=async(scannedCode:string)=>{
    if(!scannedCode||busyRef.current)return;
    busyRef.current=true;setResult(null);setError("");
    try{setResult(await api("/admin/tickets/scan",{method:"POST",body:JSON.stringify({code:scannedCode})}))}
    catch(err){setError((err as Error).message)}
    finally{busyRef.current=false}
  };
  const submitManual=(e:FormEvent)=>{e.preventDefault();runScan(code)};

  useEffect(()=>{
    let cancelled=false;
    if(!window.isSecureContext){setCameraError("La caméra nécessite une connexion sécurisée (HTTPS). Utilisez la saisie manuelle ci-dessous.");return}
    if(!navigator.mediaDevices?.getUserMedia){setCameraError("Caméra non prise en charge par ce navigateur. Utilisez la saisie manuelle ci-dessous.");return}
    const tick=()=>{
      const video=videoRef.current,canvas=canvasRef.current;
      if(video&&canvas&&video.readyState===video.HAVE_ENOUGH_DATA){
        canvas.width=video.videoWidth;canvas.height=video.videoHeight;
        const ctx=canvas.getContext("2d");
        if(ctx){
          ctx.drawImage(video,0,0,canvas.width,canvas.height);
          const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
          const found=jsQR(imageData.data,imageData.width,imageData.height);
          if(found?.data){
            const now=Date.now();
            if(found.data!==lastScanRef.current.code||now-lastScanRef.current.at>3000){
              lastScanRef.current={code:found.data,at:now};
              runScan(found.data);
            }
          }
        }
      }
      rafRef.current=requestAnimationFrame(tick);
    };
    navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}})
      .then(stream=>{
        if(cancelled){stream.getTracks().forEach(t=>t.stop());return}
        streamRef.current=stream;
        if(videoRef.current){videoRef.current.srcObject=stream;videoRef.current.play().catch(()=>{})}
        setScanning(true);
        rafRef.current=requestAnimationFrame(tick);
      })
      .catch(()=>setCameraError("Accès à la caméra refusé ou indisponible. Utilisez la saisie manuelle ci-dessous."));
    return ()=>{
      cancelled=true;
      if(rafRef.current)cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t=>t.stop());
    };
  },[]);

  return <Layout><section className="admin-page"><AdminNav/><div className="admin-main"><span className="eyebrow">ACCUEIL</span><h1>Scanner un billet</h1><div className="scanner-layout"><div className="scanner panel">
    <div className="scan-frame">
      {cameraError?<div className="camera-fallback"><span>QR</span><p>{cameraError}</p></div>
      :<video ref={videoRef} muted playsInline/>}
      {scanning&&<span className="camera-live">● Caméra active</span>}
    </div>
    <canvas ref={canvasRef} style={{display:"none"}}/>
    <form className="manual-fallback" onSubmit={submitManual}><label>Saisie manuelle (secours)<input value={code} onChange={e=>setCode(e.target.value)} placeholder="Code du billet"/></label><button className="button full">Vérifier et valider l’entrée</button></form>
  </div><aside className={`scan-result panel ${result?"success":error?"error":""}`}>{result?<><b>✓</b><h2>Entrée autorisée</h2><p>{result.participant}</p><span>{result.event}</span></>:error?<><b>×</b><h2>Entrée refusée</h2><p>{error}</p></>:<><b>⌗</b><h2>En attente d’un billet</h2><p>Présentez le QR code du billet devant la caméra, ou saisissez le code manuellement.</p></>}</aside></div></div></section></Layout>;
}
