'use client';
import { Component, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import VeyCharacter from './VeyCharacter';
import { isWobnimoCharacter } from '../../../lib/veyCharacterChoice';

const WobnimoCharacter = dynamic(() => import('./WobnimoCharacter'), { ssr: false });

// Catches errors React sees while a mascot renders; slower failures arrive through onFailure instead.
class MascotBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

// Vey's robot by default; a wobnimo mascot when the person picked one. A mascot draws with WebGL2: if it cannot start
// (old browser, blocked GPU, shader failure) the robot stands in until the choice changes, so the helper and its
// picker keep working. The saved choice is left alone.
export default function VeyAvatar({ character, ...props }) {
  const [failedFor, setFailedFor] = useState(null);
  const fail = useCallback(() => setFailedFor(character), [character]);
  if (!isWobnimoCharacter(character) || failedFor === character) return <VeyCharacter {...props} />;
  return <MascotBoundary key={character} onFail={fail}>
    <WobnimoCharacter character={character} pose={props.pose} reducedMotion={props.reducedMotion} onFailure={fail} />
  </MascotBoundary>;
}
