import { useRef, useState } from "react";
import { EXPORT_FORMAT } from "@components/canvasEditor/styleOptions";
import { TOAST_STATE } from "@constants";
import { Controller } from "@react-spring/konva";
import { getVideoPreview } from "@services/streamServices";
import { promiseToastStateStore } from "@states/promiseToastState";

const defaultSettings = {
  format: EXPORT_FORMAT.WEBM,
  quality: 100,
  framerate: 60,
  verbose: false, // show info in console,
};

const useRecorder = () => {
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [downloadInfo, setDownloadInfo] = useState({});

  const capturerRef = useRef(null);
  const animationRef = useRef(null);

  const exportVideo = ({
    api,
    canvas,
    thumbnail,
    settings = {},
    onCompleted,
  }) => {
    if (settings?.duration <= 0) return false;
    let finished = false;
    const { createToast } = promiseToastStateStore;

    const { mp4Export, widthVideo, heightVideo, duration, ...restSettings } = {
      ...defaultSettings,
      ...settings,
    };

    const capturer = new CCapture(restSettings);
    capturerRef.current = capturer;

    const totalFrames = (duration / 1000) * restSettings.framerate;

    const animations = new Controller({
      frame: 0,
      config: { duration: duration + restSettings.step },
      reset: true,
      onStart: () => {
        setDownloadInfo({});
        setProcessing(false);
        capturerRef.current.start();
        api.start();
      },
      onChange: ({ value: { frame } }) => {
        capturerRef.current.capture(canvas);
        const currentProgress = Math.round((frame / totalFrames) * 100);
        setProgress(currentProgress);
        if (currentProgress === 100) {
          finished = true;
        }
        api.resume();
      },
      onRest: () => {
        capturerRef.current.stop();
        setProgress(0);
        setProcessing(true);
        if (finished) {
          if (mp4Export) {
            capturerRef.current.save(async blodData => {
              const response = await getVideoPreview(
                {
                  blodVideo: blodData,
                  videoName: restSettings.name,
                  width: widthVideo,
                  height: heightVideo,
                  blodThumbnail: thumbnail,
                },
                infoData => setDownloadInfo(infoData)
              );
              if (!response) {
                createToast({
                  label: "Export video failed, please try again.",
                  status: TOAST_STATE.ERROR,
                  isLoading: false,
                  duration: 3,
                });
              } else {
                createToast({
                  label: "Download completed",
                  status: TOAST_STATE.SUCCESS,
                  isLoading: false,
                  duration: 3,
                });
              }
              onCompleted();
              setProcessing(false);
            });
          } else {
            capturerRef.current.save();
            onCompleted();
            setProcessing(false);
          }
        }
      },
    });

    animationRef.current = animations;
    animationRef.current.start({ frame: totalFrames });
    return true;
  };

  const cancelExport = () => {
    setProgress(0);
    setProcessing(false);
    capturerRef?.current && capturerRef.current.stop();
    animationRef?.current && animationRef.current.stop();
  };

  return {
    progress,
    processing,
    downloadInfo,
    exportVideo,
    cancelExport,
  };
};

export default useRecorder;
