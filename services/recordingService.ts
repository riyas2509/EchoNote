import { db, storage, auth } from '../firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  serverTimestamp, 
  addDoc,
  getDoc
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytesResumable, 
  getDownloadURL 
} from 'firebase/storage';
import { Recording, Transcript, Usage } from '../types';
import { processAudioTranscription } from './aiService';

export const uploadAudioToStorage = async (file: File | Blob, userId: string, recordId: string, fileName?: string): Promise<string> => {
  const actualFileName = fileName || (file instanceof File ? file.name : `live_recording_${Date.now()}.webm`);
  const storagePath = `recordings/${userId}/${recordId}/${actualFileName}`;
  const storageRef = ref(storage, storagePath);
  const uploadTask = await uploadBytesResumable(storageRef, file);
  return await getDownloadURL(uploadTask.ref);
};

export const uploadAndProcessRecording = async (
  file: File,
  projectId: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");

  // 0. Check Usage
  const usageRef = doc(db, 'usage', user.uid);
  const usageSnap = await getDoc(usageRef);
  if (usageSnap.exists()) {
    const usageData = usageSnap.data() as Usage;
    if (usageData.minutesUsed >= usageData.monthlyLimit) {
      throw new Error("Monthly usage limit exceeded. Please upgrade your plan.");
    }
  }

  const recordingId = doc(collection(db, 'recordings')).id;
  const storagePath = `recordings/${user.uid}/${recordingId}/${file.name}`;
  const storageRef = ref(storage, storagePath);

  // 1. Initial Firestore Doc
  const recording: Recording = {
    id: recordingId,
    projectId,
    userId: user.uid,
    fileName: file.name,
    storagePath,
    status: 'uploading',
    mimeType: file.type,
    createdAt: new Date().toISOString()
  };

  await setDoc(doc(db, 'recordings', recordingId), {
    ...recording,
    createdAt: serverTimestamp()
  });

  // 2. Upload to Storage
  const uploadTask = uploadBytesResumable(storageRef, file);

  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        if (onProgress) onProgress(progress);
      },
      (error) => reject(error),
      async () => {
        try {
          // 3. Update status to processing
          await updateDoc(doc(db, 'recordings', recordingId), {
            status: 'processing'
          });

          // 4. Trigger AI Processing (Simulating Cloud Function)
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onloadend = async () => {
            try {
              const base64Audio = (reader.result as string).split(',')[1];
              const aiResult = await processAudioTranscription(base64Audio, file.type);

              // 5. Store Transcription
              const transcriptionId = doc(collection(db, 'transcriptions')).id;
              const transcript: Transcript = {
                id: transcriptionId,
                recordingId,
                userId: user.uid,
                summary: aiResult.summary || '',
                actionItems: aiResult.actionItems || [],
                segments: aiResult.segments || [],
                createdAt: new Date().toISOString()
              };

              await setDoc(doc(db, 'transcriptions', transcriptionId), {
                ...transcript,
                createdAt: serverTimestamp()
              });

              // 6. Final Status Update
              await updateDoc(doc(db, 'recordings', recordingId), {
                status: 'completed'
              });

              resolve(recordingId);
            } catch (aiError) {
              console.error("AI Error:", aiError);
              await updateDoc(doc(db, 'recordings', recordingId), {
                status: 'error',
                errorMessage: aiError instanceof Error ? aiError.message : "AI processing failed"
              });
              reject(aiError);
            }
          };
        } catch (error) {
          reject(error);
        }
      }
    );
  });
};
