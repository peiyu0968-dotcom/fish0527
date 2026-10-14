import { useState } from 'react';
import type { OnlineUser } from './backend/types';
import { backend, debugEnabled, getDebugControls } from './config';
import { ChatRoom } from './components/ChatRoom/ChatRoom';
import { DebugPanel } from './components/DebugPanel/DebugPanel';
import { JoinScreen } from './components/JoinScreen/JoinScreen';
import { useTheme } from './hooks/useTheme';

type Stage = { name: 'join'; notice?: string } | { name: 'room'; nickname: string; online: OnlineUser[] };

/** 只有兩個畫面：輸入代號、聊天室。用一個狀態切換，不需要網址路由。 */
export default function App() {
  const { theme, toggle } = useTheme();
  const [stage, setStage] = useState<Stage>({ name: 'join' });
  const debug = debugEnabled ? getDebugControls(backend) : null;

  return (
    <>
      {stage.name === 'join' ? (
        <JoinScreen
          backend={backend}
          theme={theme}
          onToggleTheme={toggle}
          notice={stage.notice}
          onJoined={(nickname, online) => setStage({ name: 'room', nickname, online })}
        />
      ) : (
        <ChatRoom
          backend={backend}
          nickname={stage.nickname}
          initialOnline={stage.online}
          theme={theme}
          onToggleTheme={toggle}
          onLeft={(notice) => setStage({ name: 'join', notice })}
        />
      )}
      {debug && <DebugPanel controls={debug} />}
    </>
  );
}
