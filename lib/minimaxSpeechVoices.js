export const TTS_SCRIPT_LIMIT = 500;

// MiniMax publishes no gender for these general voice ids. Gender follows the
// name, and for the two names that do not say it, MiniMax's documented English
// voice of the same name: English_FriendlyPerson "Male (Adult)" ("Friendly
// Guy") and English_ImposingManner "Female (Adult)" ("Imposing Queen").
export const TTS_VOICES = [
  { id: 'Wise_Woman', label: 'Wise woman', tone: 'Measured', gender: 'female', age: 'older' },
  { id: 'Friendly_Person', label: 'Friendly person', tone: 'Warm', gender: 'male', age: 'middle' },
  { id: 'Inspirational_girl', label: 'Inspirational girl', tone: 'Upbeat', gender: 'female', age: 'young' },
  { id: 'Deep_Voice_Man', label: 'Deep voice man', tone: 'Rich', gender: 'male', age: 'middle' },
  { id: 'Calm_Woman', label: 'Calm woman', tone: 'Relaxed', gender: 'female', age: 'middle' },
  { id: 'Casual_Guy', label: 'Casual guy', tone: 'Conversational', gender: 'male', age: 'young' },
  { id: 'Lively_Girl', label: 'Lively girl', tone: 'Energetic', gender: 'female', age: 'young' },
  { id: 'Patient_Man', label: 'Patient man', tone: 'Clear', gender: 'male', age: 'middle' },
  { id: 'Young_Knight', label: 'Young knight', tone: 'Confident', gender: 'male', age: 'young' },
  { id: 'Determined_Man', label: 'Determined man', tone: 'Assertive', gender: 'male', age: 'middle' },
  { id: 'Lovely_Girl', label: 'Lovely girl', tone: 'Gentle', gender: 'female', age: 'young' },
  { id: 'Decent_Boy', label: 'Decent boy', tone: 'Neutral', gender: 'male', age: 'young' },
  { id: 'Imposing_Manner', label: 'Imposing manner', tone: 'Commanding', gender: 'female', age: 'middle' },
  { id: 'Elegant_Man', label: 'Elegant man', tone: 'Polished', gender: 'male', age: 'middle' },
  { id: 'Abbess', label: 'Abbess', tone: 'Serene', gender: 'female', age: 'older' },
  { id: 'Sweet_Girl_2', label: 'Sweet girl', tone: 'Bright', gender: 'female', age: 'young' },
  { id: 'Exuberant_Girl', label: 'Exuberant girl', tone: 'Expressive', gender: 'female', age: 'young' },
];
