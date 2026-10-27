import { Archivo_600SemiBold, Archivo_700Bold, Archivo_800ExtraBold } from '@expo-google-fonts/archivo';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import type { FontSource } from 'expo-font';
import type { Typeface } from '../../theme';
const archivo = { Archivo_700Bold, Archivo_800ExtraBold };
const inter = { Inter_400Regular, Inter_500Medium, Inter_600SemiBold };
export const typefaceFonts: Record<Typeface, Record<string, FontSource>> = {
    studio: { ...archivo, Archivo_600SemiBold },
    editorial: { ...archivo, ...inter, InstrumentSerif_400Regular },
    technical: { ...archivo, ...inter, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold },
};
export const previewFonts = { ...typefaceFonts.studio, ...typefaceFonts.editorial, ...typefaceFonts.technical };
