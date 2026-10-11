import { audioSampler,abortIfNeeded,yieldAudio } from './editorTimeStretch.mjs';
/** In-place radix-2 transform, used only with a fixed 2048-sample analysis window. */
export function fft(real,imag,inverse=false) {
    const n=real.length;if(n!==imag.length || n<2 || (n&(n-1)))throw new Error('FFT needs equal power-of-two buffers.');
    for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[real[i],real[j]]=[real[j],real[i]];[imag[i],imag[j]]=[imag[j],imag[i]];}}
    for(let size=2;size<=n;size*=2){const angle=(inverse?2:-2)*Math.PI/size,cos=Math.cos(angle),sin=Math.sin(angle);for(let base=0;base<n;base+=size){let wr=1,wi=0;for(let k=0;k<size/2;k++){const a=base+k,b=a+size/2,tr=wr*real[b]-wi*imag[b],ti=wr*imag[b]+wi*real[b];real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti;const next=wr*cos-wi*sin;wi=wr*sin+wi*cos;wr=next;}}}
    if(inverse)for(let i=0;i<n;i++){real[i]/=n;imag[i]/=n;}
}
/** Learned spectral suppression. The explicitly chosen source range must contain noise alone. */
export async function suppressNoise(chunks,settings,sampleRate,signal) {
    abortIfNeeded(signal);if(!settings.noiseReduction || !chunks.length)return chunks;
    const size=2048,hop=512,sample=audioSampler(chunks),first=chunks[0].timestamp,last=chunks.at(-1),end=last.timestamp+last.channels[0].length/last.sampleRate,length=Math.ceil((end-first)*sampleRate),bins=size/2+1;
    const window=Float64Array.from({length:size},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(size-1))),profile=new Float64Array(bins),real=new Float64Array(size),imag=new Float64Array(size);
    let learned=0;
    for(let at=settings.noiseStart;at+size/sampleRate<=settings.noiseStart+settings.noiseLength;at+=hop/sampleRate){for(let ch=0;ch<2;ch++){for(let i=0;i<size;i++){real[i]=sample(at+i/sampleRate,ch)*window[i];imag[i]=0;}fft(real,imag);for(let k=0;k<bins;k++)profile[k]+=(real[k]**2+imag[k]**2)*.5;}learned++;}
    if(!learned)throw new Error('Choose a noise-only sample at least 0.05 seconds long.');for(let k=0;k<bins;k++)profile[k]/=learned;
    const out=[new Float32Array(length),new Float32Array(length)],weights=new Float32Array(length);
    let batch=0;
    for(let center=0;center<length+size/2;center+=hop){abortIfNeeded(signal);const begin=center-size/2;
        for(let ch=0;ch<2;ch++){for(let i=0;i<size;i++){const j=begin+i;real[i]=(j>=0&&j<length?sample(first+j/sampleRate,ch):0)*window[i];imag[i]=0;}fft(real,imag);
            for(let k=0;k<size;k++){const bin=k<=size/2?k:size-k,power=real[k]**2+imag[k]**2,gain=Math.sqrt(Math.max(.025,1-settings.noiseReduction*2*profile[bin]/Math.max(1e-16,power)));real[k]*=gain;imag[k]*=gain;}
            fft(real,imag,true);for(let i=0;i<size;i++){const j=begin+i;if(j<0||j>=length)continue;out[ch][j]+=real[i]*window[i];if(!ch)weights[j]+=window[i]**2;}
        }
        if(++batch%32===0)await yieldAudio();
    }
    for(let i=0;i<length;i++)if(weights[i])for(let ch=0;ch<2;ch++)out[ch][i]/=weights[i];
    abortIfNeeded(signal);return [{timestamp:first,sampleRate,channels:out}];
}
