/** Preserve channel balance by normalizing one shared peak only when a mix exceeds full scale. */
export function peakNormalizeChannels(channels) {
    let peak=1;
    for(const samples of channels)for(const sample of samples)peak=Math.max(peak,Math.abs(sample));
    if(peak>1)for(const samples of channels)for(let index=0;index<samples.length;index++)samples[index]/=peak;
    return channels;
}
