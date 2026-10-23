/**
 * Live webcam preview bubble. The whole window is a drag handle; it is excluded
 * from the screen capture (the webcam is recorded as its own track).
 */
import { useEffect, useRef } from "react";

export function Bubble({ deviceId }: { deviceId: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    void navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 640 } } })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      });
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [deviceId]);
  return (
    <div className="bubble">
      <video ref={video} autoPlay muted playsInline />
    </div>
  );
}
