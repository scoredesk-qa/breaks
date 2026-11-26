function useAgentNotifListener(userId, lunchInfo) {
  // one subscription for the whole session (the group is read through a ref), so it is never torn down and re-joined on the same channel name
  const grpRef = useRef(null);
  grpRef.current = lunchInfo?.group || null;
  useEffect(() => {
    let ch = null, dead = false, retry = null, tries = 0, gen = 0;
    const drop = () => { if (ch) { try { SB.removeChannel(ch); } catch (e) {} ch = null; } };
    const connect = () => {
      if (dead) return;
      drop();
      const my = ++gen;
      ch = SB.channel(BROADCAST_CHANNEL)
        .on('broadcast', { event: BROADCAST_EVENT }, ({ payload }) => {
          if (!payload) return;
          if (payload.targetUserId && payload.targetUserId !== userId) return;
          if (payload.lunchGroup && (!grpRef.current || grpRef.current !== payload.lunchGroup)) return;
          fireNotification({ title: payload.title, body: payload.body, type: payload.type || 'custom', duration: 9000 });
        })
        .subscribe(status => {
          if (my !== gen || dead) return;
          if (status === 'SUBSCRIBED') { tries = 0; return; }
          if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') && !retry) {
            retry = setTimeout(() => { retry = null; tries++; connect(); }, Math.min(30000, 2000 * (tries + 1)));
          }
        });
    };
    connect();
    const vis = () => { if (document.visibilityState === 'visible' && ch && ch.state && ch.state !== 'joined' && !retry) connect(); };
    document.addEventListener('visibilitychange', vis);
    return () => { dead = true; clearTimeout(retry); document.removeEventListener('visibilitychange', vis); drop(); };
  }, [userId]);
}

