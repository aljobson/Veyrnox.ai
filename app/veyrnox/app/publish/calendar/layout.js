import { notFound } from 'next/navigation';
import { calendarEnabled } from '../../../../../lib/social/publishFeature.js';
export default function CalendarLayout({children}) {
    if(!calendarEnabled())notFound();
    return children;
}
