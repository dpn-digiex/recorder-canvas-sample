import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { editorStore } from "@components/canvasEditor/store/canvas/rootStore";
import {
  CANVAS_MODE,
  PREVIEW_STATE,
} from "@components/canvasEditor/styleOptions";
import Slider from "@components/common/Slider";
import { ELEMENT_TEMPLATE_TYPE } from "@constants";
import { getAdminConfig } from "@services/templateServices";
import { base64ToBlob } from "@utils/exporter";
import { observer } from "mobx-react";

import AnimationCanvas from "../animationCanvas";

import styles from "./index.module.scss";

const TIMEOUT_ACCEPTED = 30000; // 30s
// const FRAME_RATE = 60; // fps
const CANVAS_ID = "canvas-recorder";
const BLOB_VIDEO_ID = "blob-video-template";
const VIDEO_PATH_ID = "video-path";
const BLOB_THUMBNAIL_ID = "blob-thumbnail-template";
const DELAY_SEND_MSS_SUCCESS = 200; // 0.2s
const MESSAGE_ERROR_ID = "recorder-message-error";
const MESSAGE_SUCCESS_ID = "finish-prepare-data-export";
const IDEAL_RESOLUTION = 1200; // pixel

const MESSAGE_EMIT = {
  TIMEOUT: "The process to render template is taking too long!",
  GET_TEMPLATE_DATA_ERROR: "Error when get template data!",
  REQUIRED_TEMPLATE_INFO: "This template is missing domainId or sizeId!",
};

const authToken = "1";
const testDownloadWebm = false;

const ExporterWorkspace = observer(({ getTemplateDetail = () => {} }) => {
  const [finishedRecord, setFinishedRecord] = useState(false);
  const [thumbnailPoster, setThumbnailPoster] = useState(null);
  const [isLoading, setIsLoading] = useState({
    template: false,
    adminConfig: false,
  });
  const [resolution, setResolution] = useState({
    width: 0,
    height: 0,
    scale: 0,
  });
  const [preparedDataExport, setPreparedDataExport] = useState({
    video: false,
    thumbnail: false,
  });
  const [templateInfo, setTemplateInfo] = useState({
    templateId: "",
    domainId: "",
  });

  const [searchParams] = useSearchParams();

  const sizeId = searchParams.get("sizeId");
  const extension = searchParams.get("extension");
  // const authToken = searchParams.get("authToken");
  // const domainId = searchParams.get("domainId");

  const recorder = useRef(null);
  const chunks = useRef([]);

  const allowInitRecorder = useMemo(() => {
    return (
      !isLoading.adminConfig &&
      !isLoading.template &&
      resolution.scale > 0 &&
      editorStore.availablePages?.length > 0 &&
      thumbnailPoster
    );
  }, [
    isLoading.adminConfig,
    isLoading.template,
    editorStore.availablePages,
    resolution.scale,
    thumbnailPoster,
  ]);

  const getAnimationAdminConfig = async () => {
    setIsLoading(prev => ({ ...prev, adminConfig: true }));
    const result = await getAdminConfig(authToken);
    editorStore.setAnimationAdminConfig(result?.config || {});
    setIsLoading(prev => ({ ...prev, adminConfig: false }));
  };

  const getTemplateData = async () => {
    setIsLoading(prev => ({ ...prev, template: true }));
    const result = await getTemplateDetail(
      { templateSizeId: sizeId },
      authToken
    );
    if (result?.length > 0) {
      if (!result[0]?.templateId && !result[0]?.domainId) {
        createMessageElement(MESSAGE_EMIT.REQUIRED_TEMPLATE_INFO);
      } else {
        editorStore.setStore({ pages: result, templateSizeId: sizeId }, true);
        setTemplateInfo({
          templateId: result[0].templateId,
          domainId: result[0].domainId,
        });
      }
    } else {
      console.log("__ERROR GET TEMPLATE DATA__");
      createMessageElement(MESSAGE_EMIT.GET_TEMPLATE_DATA_ERROR);
    }
    setIsLoading(prev => ({ ...prev, template: false }));
  };

  const initStores = () => {
    editorStore.init();
  };

  const destroyStores = () => {
    editorStore.destroy();
  };

  useEffect(() => {
    initStores();
    getAnimationAdminConfig();
    getTemplateData();
    return () => {
      destroyStores();
    };
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (!editorStore.isFinishedRenderTemplate && !finishedRecord) {
        console.log("CLIENT LOG: __TIMEOUT RENDER TEMPLATE__");
        createMessageElement(MESSAGE_EMIT.TIMEOUT);
      }
    }, TIMEOUT_ACCEPTED);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [editorStore.isFinishedRenderTemplate, finishedRecord]);

  // adjust resolution size to smooth animation on canvas
  useEffect(() => {
    if (editorStore.width && editorStore.height) {
      adjustResolutionSize(editorStore.width, editorStore.height);
    }
  }, [editorStore.width, editorStore.height]);

  // start record video when all conditions are met
  useEffect(() => {
    if (editorStore.isFinishedRenderTemplate && allowInitRecorder) {
      initRecorder().then(() => {
        startRecordVideo();
      });
    }
  }, [editorStore.isFinishedRenderTemplate, allowInitRecorder]);

  // finish record video when animation is completed
  // useEffect(() => {
  //   if (animationStore.stateVideoAnimate === PREVIEW_STATE.FINISHED) {
  //     finishRecordVideo();
  //   }
  // }, [animationStore.stateVideoAnimate]);

  // wait to prepare data export & send notification to server
  useEffect(() => {
    if (preparedDataExport.video && preparedDataExport.poster) {
      console.log("FINISH PREPARE DATA EXPORT");
      setTimeout(() => {
        createMessageElement("", MESSAGE_SUCCESS_ID);
      }, DELAY_SEND_MSS_SUCCESS);
    }
  }, [preparedDataExport]);

  const initRecorder = async () => {
    return new Promise(resolve => {
      const canvas = document.getElementById(CANVAS_ID);
      const canvasStream = canvas?.captureStream();
      const audioOfVideoStreams =
        extension === "gif" ? null : getAudioOfVideoStreams();
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(), // Add video tracks from the canvas
        ...(audioOfVideoStreams
          ? audioOfVideoStreams.stream.getAudioTracks()
          : []), // Add audio tracks from the mixed audio stream
      ]);

      recorder.current = new MediaRecorder(combinedStream, {
        mimeType: `video/webm;codecs=${extension === "gif" ? "h264" : "vp9"}`,
        // videoBitsPerSecond: 30 * 1024 * 1024, // Mbps,
      });
      recorder.current.ondataavailable = handleDataAvailable;
      recorder.current.onstop = handleStopRecord;
      resolve();
    });
  };

  const getAudioOfVideoStreams = () => {
    let audioStreams = [];
    editorStore.availablePages.forEach(page => {
      const children = page.children || [];
      return children
        .filter(
          child =>
            child?.type === ELEMENT_TEMPLATE_TYPE.VIDEO ||
            child?.elementType === ELEMENT_TEMPLATE_TYPE.VIDEO
        )
        .forEach(videoChild => {
          const audioStream = videoChild.image
            ?.captureStream()
            .getAudioTracks()[0];
          if (audioStream) {
            audioStreams.push(audioStream);
          }
        });
    });
    if (audioStreams.length === 0) return null;

    // create only one mixed audio stream
    const audioContext = new AudioContext();
    const mixedAudioStream = audioContext.createMediaStreamDestination();

    audioStreams.forEach(audioTrack => {
      const source = audioContext.createMediaStreamSource(
        new MediaStream([audioTrack])
      );
      source.connect(mixedAudioStream);
    });
    return mixedAudioStream;
  };

  const handleDataAvailable = event => {
    if (event.data.size > 0) {
      chunks.current.push(event.data);
    }
  };

  const handleStopRecord = async () => {
    const blobPoster = await base64ToBlob(thumbnailPoster, "image/jpeg");
    const blobVideo = new Blob(chunks.current, {
      type: "video/webm",
    });

    const readerVideo = new FileReader();
    const readerPoster = new FileReader();

    readerVideo.onloadend = () => {
      const pathVideoElement = document.createElement("span");
      pathVideoElement.id = VIDEO_PATH_ID;
      pathVideoElement.innerHTML = `ExportTemplate/${sizeId}.webm`;
      document.body.appendChild(pathVideoElement);

      const blobVideoElement = document.createElement("span");
      blobVideoElement.id = BLOB_VIDEO_ID;
      const base64Video = readerVideo.result.replace(
        /data:video\/webm;codecs=[^;]+;base64,/,
        ""
      );
      blobVideoElement.innerHTML = base64Video;
      document.body.appendChild(blobVideoElement);
      setPreparedDataExport(prev => ({ ...prev, video: true }));
    };

    readerPoster.onloadend = () => {
      const blobThumbnailElement = document.createElement("span");
      blobThumbnailElement.id = BLOB_THUMBNAIL_ID;
      const base64poster = readerPoster.result.replace(
        /data:image\/jpeg;base64,/,
        ""
      );
      blobThumbnailElement.innerHTML = base64poster;
      document.body.appendChild(blobThumbnailElement);
      setPreparedDataExport(prev => ({ ...prev, poster: true }));
    };

    readerVideo.readAsDataURL(blobVideo);
    readerPoster.readAsDataURL(blobPoster);

    if (testDownloadWebm) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blobVideo);
      a.download = "test.webm";
      a.click();
    }
  };

  const startRecordVideo = () => {
    if (!recorder.current) return;
    if (recorder.current.state === "recording") {
      console.log("STOP RECORDING");
      recorder.current.stop();
      // animationStore.videoActions.pause();
      return;
    }
    console.log("START RECORDING");
    recorder.current.start();
    // setTimeout(() => {
    //   animationStore.videoActions?.play({ modeExporter: true });
    // }, 400);
  };

  const finishRecordVideo = () => {
    console.log("COMPLETED RECORDING");
    setFinishedRecord(true);
    recorder.current.stop();
  };

  const createMessageElement = (message = "", id) => {
    const messageElement = document.createElement("span");
    messageElement.id = id || MESSAGE_ERROR_ID;
    messageElement.innerHTML = message;
    document.body.appendChild(messageElement);
  };

  const adjustResolutionSize = (originalWidth, originalHeight) => {
    let scale;
    if (originalWidth > originalHeight) {
      scale = IDEAL_RESOLUTION / originalWidth;
    } else {
      scale = IDEAL_RESOLUTION / originalHeight;
    }
    let adjustedWidth = Math.round(originalWidth * scale);
    let adjustedHeight = Math.round(originalHeight * scale);
    if (adjustedWidth % 2 !== 0) {
      adjustedWidth = adjustedWidth + 1;
    }
    if (adjustedHeight % 2 !== 0) {
      adjustedHeight = adjustedHeight + 1;
    }
    setResolution({ width: adjustedWidth, height: adjustedHeight, scale });
  };

  return (
    <div className={styles.wrapperWorkspaces}>
      <div
        className={styles.wrapperVideoStage}
        style={{ width: `${resolution.width}px` }}
      >
        <AnimationCanvas
          getThumbnail={setThumbnailPoster}
          scale={resolution.scale}
          canvasMode={CANVAS_MODE.EXPORTER}
          canvasId={CANVAS_ID}
          editorStore={editorStore}
          storedFonts={editorStore.storedFontsToJS}
        />
        {/* BoxControl */}
        <div
          className={styles.boxControl}
          style={{ width: `${resolution.width}px` }}
        >
          <Slider
            size="small"
            aria-label="Small"
            valueLabelDisplay="auto"
            step={0.1}
            defaultValue={0}
            value={0}
            max={editorStore.totalTime}
            min={0}
            onChange={() => null}
            sx={{
              "& .MuiSlider-thumb:not(.MuiSlider-active)": {
                transition: "left 0.1s ease-in",
              },
              "& .MuiSlider-track": {
                transition: "width 0.1s ease-in",
              },
            }}
          />
        </div>
      </div>
    </div>
  );
});

export default ExporterWorkspace;
