export const missingAlbumExportReader = (error) => [400, 404].includes(error?.status)
    && ['PGRST202', '42883'].includes(error?.body?.code);
