import { Archivo_600SemiBold } from '@expo-google-fonts/archivo/600SemiBold';
import { Archivo_700Bold } from '@expo-google-fonts/archivo/700Bold';
import { Archivo_800ExtraBold } from '@expo-google-fonts/archivo/800ExtraBold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif/400Regular';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk/500Medium';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';
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
