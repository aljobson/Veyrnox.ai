import { proxyToMuapi } from '@/lib/muapiProxy';

export async function GET(request) {
    return proxyToMuapi(request, '/app/get_file_upload_url', 'GET');
}
