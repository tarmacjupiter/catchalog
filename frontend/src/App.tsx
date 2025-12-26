import { useState, useEffect } from "react";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  updateDoc,
  doc,
  deleteDoc,
} from "firebase/firestore";
import { auth, googleProvider, storage, db } from "./firebase";

interface FishCatch {
  id: string;
  userId?: string;
  userDisplayName?: string;
  userPhotoURL?: string;
  imageUrl: string;
  storagePath?: string; // Add this to track the storage path
  identification: {
    commonName: string;
    scientificName: string;
    confidence: string;
    characteristics: string[];
    habitat: string;
    averageSize: string;
    notes: string;
    family?: string;
  };
  catchDetails: {
    location?: string;
    method?: string;
    date?: string;
    notes?: string;
  };
  timestamp: any;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [catches, setCatches] = useState<FishCatch[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [catchDetails, setCatchDetails] = useState({
    location: "",
    method: "",
    notes: "",
  });
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [selectedCatch, setSelectedCatch] = useState<FishCatch | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedDetails, setEditedDetails] = useState({
    location: "",
    method: "",
    notes: "",
    commonName: "",
    scientificName: "",
  });
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("darkMode");
    return saved ? JSON.parse(saved) : false;
  });
  const [activeTab, setActiveTab] = useState<"my-catches" | "community">(
    "my-catches"
  );
  const [communityCatches, setCommunityCatches] = useState<FishCatch[]>([]);
  const [fullPhotoUrl, setFullPhotoUrl] = useState<string | null>(null);
  const [selectedUserFilter, setSelectedUserFilter] = useState<string>("all");

  useEffect(() => {
    localStorage.setItem("darkMode", JSON.stringify(darkMode));
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        loadCatches(currentUser.uid);
        loadCommunityCatches();
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Error signing in:", error);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setCatches([]);
      setShowProfileMenu(false);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const loadCatches = async (userId: string) => {
    const q = query(
      collection(db, "catches"),
      where("userId", "==", userId),
      orderBy("timestamp", "desc")
    );

    const querySnapshot = await getDocs(q);
    const loadedCatches: FishCatch[] = [];
    querySnapshot.forEach((doc) => {
      loadedCatches.push({ id: doc.id, ...doc.data() } as FishCatch);
    });
    setCatches(loadedCatches);
  };

  const loadCommunityCatches = async () => {
    const q = query(collection(db, "catches"), orderBy("timestamp", "desc"));

    const querySnapshot = await getDocs(q);
    const loadedCatches: FishCatch[] = [];
    querySnapshot.forEach((doc) => {
      loadedCatches.push({ id: doc.id, ...doc.data() } as FishCatch);
    });
    setCommunityCatches(loadedCatches);
  };

  const isOwnCatch = (catch_: FishCatch) => {
    return user && catch_.userId === user.uid;
  };

  // Get unique users from community catches for filter
  const uniqueUsers = communityCatches.reduce((acc, catch_) => {
    if (catch_.userId && catch_.userDisplayName && !acc.find(u => u.userId === catch_.userId)) {
      acc.push({ userId: catch_.userId, displayName: catch_.userDisplayName });
    }
    return acc;
  }, [] as { userId: string; displayName: string }[]);

  // Filter community catches by selected user
  const filteredCommunityCatches = selectedUserFilter === "all"
    ? communityCatches
    : communityCatches.filter(c => c.userId === selectedUserFilter);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);

      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadAndIdentify = async () => {
    if (!selectedFile || !user) return;

    setUploading(true);
    try {
      const timestamp = Date.now();
      const storagePath = `catches/${user.uid}/${timestamp}_${selectedFile.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, selectedFile);
      const downloadUrl = await getDownloadURL(storageRef);

      // Use environment variable
      const API_URL =
        import.meta.env.VITE_API_URL ||
        "https://us-central1-fishidy-36f28.cloudfunctions.net/identifyFish";

      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: storagePath,
          imageDownloadUrl: downloadUrl,
          userId: user.uid,
          catchDetails: {
            ...catchDetails,
            date: new Date().toISOString(),
          },
        }),
      });

      const result = await response.json();

      await loadCatches(user.uid);
      await loadCommunityCatches();

      setSelectedFile(null);
      setPreviewUrl(null);
      setCatchDetails({ location: "", method: "", notes: "" });

      alert(`Fish identified: ${result.identification.commonName}`);
    } catch (error) {
      console.error("Error uploading:", error);
      alert("Error uploading and identifying fish");
    } finally {
      setUploading(false);
    }
  };

  const handleEditCatch = () => {
    if (selectedCatch) {
      setEditedDetails({
        location: selectedCatch.catchDetails.location || "",
        method: selectedCatch.catchDetails.method || "",
        notes: selectedCatch.catchDetails.notes || "",
        commonName: selectedCatch.identification.commonName || "",
        scientificName: selectedCatch.identification.scientificName || "",
      });
      setIsEditing(true);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedCatch || !user) return;

    try {
      const catchRef = doc(db, "catches", selectedCatch.id);
      await updateDoc(catchRef, {
        "catchDetails.location": editedDetails.location,
        "catchDetails.method": editedDetails.method,
        "catchDetails.notes": editedDetails.notes,
        "identification.commonName": editedDetails.commonName,
        "identification.scientificName": editedDetails.scientificName,
      });

      const updatedCatch = {
        ...selectedCatch,
        catchDetails: {
          ...selectedCatch.catchDetails,
          location: editedDetails.location,
          method: editedDetails.method,
          notes: editedDetails.notes,
        },
        identification: {
          ...selectedCatch.identification,
          commonName: editedDetails.commonName,
          scientificName: editedDetails.scientificName,
        },
      };
      setSelectedCatch(updatedCatch);
      setCatches(
        catches.map((c) => (c.id === selectedCatch.id ? updatedCatch : c))
      );
      setIsEditing(false);

      alert("Catch details updated successfully!");
    } catch (error) {
      console.error("Error updating catch:", error);
      alert("Error updating catch details");
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedDetails({
      location: selectedCatch?.catchDetails.location || "",
      method: selectedCatch?.catchDetails.method || "",
      notes: selectedCatch?.catchDetails.notes || "",
      commonName: selectedCatch?.identification.commonName || "",
      scientificName: selectedCatch?.identification.scientificName || "",
    });
  };

  const handleDeleteCatch = async () => {
    if (!selectedCatch || !user) return;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete this catch of ${selectedCatch.identification.commonName}? This action cannot be undone.`
    );

    if (!confirmDelete) return;

    try {
      // 1. DELETE FROM STORAGE
      try {
        // Create a reference directly from the download URL
        // This avoids manual string splitting which was causing the 404 error
        const imageRef = ref(storage, selectedCatch.imageUrl);
        await deleteObject(imageRef);
        console.log("Storage object deleted successfully");
      } catch (storageError) {
        // If the file is already gone (404), we can just log it and move to Firestore
        console.warn(
          "Storage file not found or already deleted:",
          storageError
        );
      }

      // 2. DELETE FROM FIRESTORE
      const catchRef = doc(db, "catches", selectedCatch.id);
      await deleteDoc(catchRef);

      // 3. UPDATE UI STATE
      setCatches((prevCatches) =>
        prevCatches.filter((c) => c.id !== selectedCatch.id)
      );
      setSelectedCatch(null);
      setIsEditing(false);

      alert("Catch deleted successfully!");
    } catch (error) {
      console.error("Error deleting catch:", error);
      alert("Error deleting catch. Please check your console for details.");
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 via-cyan-500 to-teal-500 dark:from-slate-900 dark:via-blue-900 dark:to-slate-800 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4xIj48cGF0aCBkPSJNMzYgMzRjMC0yLjIxLTEuNzktNC00LTRzLTQgMS43OS00IDQgMS43OSA0IDQgNCA0LTEuNzkgNC00em0wLTEwYzAtMi4yMS0xLjc5LTQtNC00cy00IDEuNzktNCA0IDEuNzkgNCA0IDQgNC0xLjc5IDQtNHptMC0xMGMwLTIuMjEtMS43OS00LTQtNHMtNCAxLjc5LTQgNCAxLjc5IDQgNCA0IDQtMS43OSA0LTR6TTEyIDM0YzAtMi4yMS0xLjc5LTQtNC00cy00IDEuNzktNCA0IDEuNzkgNCA0IDQgNC0xLjc5IDQtNHptMC0xMGMwLTIuMjEtMS43OS00LTQtNHMtNCAxLjc5LTQgNCAxLjc5IDQgNCA0IDQtMS43OSA0LTR6bTAtMTBjMC0yLjIxLTEuNzktNC00LTRzLTQgMS43OS00IDQgMS43OSA0IDQgNCA0LTEuNzkgNC00em00OCAwYzAtMi4yMS0xLjc5LTQtNC00cy00IDEuNzktNCA0IDEuNzkgNCA0IDQgNC0xLjc5IDQtNHptMCAxMGMwLTIuMjEtMS43OS00LTQtNHMtNCAxLjc5LTQgNCAxLjc5IDQgNCA0IDQtMS43OSA0LTR6bTAgMTBjMC0yLjIxLTEuNzktNC00LTRzLTQgMS43OS00IDQgMS43OSA0IDQgNCA0LTEuNzkgNC00eiIvPjwvZz48L2c+PC9zdmc+')] opacity-20"></div>

        <button
          onClick={() => setDarkMode(!darkMode)}
          className="absolute top-6 right-6 w-12 h-12 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-full flex items-center justify-center text-2xl transition-all shadow-lg z-10"
        >
          {darkMode ? "☀️" : "🌙"}
        </button>

        <div className="text-center z-10 px-4">
          <div className="mb-8 flex justify-center">
            <div className="text-8xl drop-shadow-2xl">🎣</div>
          </div>
          <h1 className="text-7xl font-black text-white mb-4 drop-shadow-lg">
            Fishidy
          </h1>
          <p className="text-2xl text-white/90 mb-12 font-light">
            AI-Powered Fishing Diary
          </p>
          <button
            onClick={handleSignIn}
            className="bg-white text-blue-600 dark:bg-slate-800 dark:text-cyan-400 px-10 py-4 rounded-full hover:bg-blue-50 dark:hover:bg-slate-700 transition-all shadow-2xl font-semibold text-lg hover:scale-105 transform"
          >
            Sign in with Google →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 transition-colors">
      {/* Header */}
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md shadow-sm border-b border-gray-100 dark:border-slate-700 sticky top-0 z-50 transition-colors">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-4xl">🎣</span>
            <h1 className="text-3xl font-black bg-gradient-to-r from-blue-600 to-cyan-500 dark:from-cyan-400 dark:to-blue-400 bg-clip-text text-transparent">
              Fishidy
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="w-10 h-10 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-full flex items-center justify-center text-xl transition-all shadow-md"
            >
              {darkMode ? "☀️" : "🌙"}
            </button>

            <div className="relative">
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="w-12 h-12 rounded-full overflow-hidden border-3 border-blue-500 dark:border-cyan-400 hover:border-blue-600 dark:hover:border-cyan-300 transition-all shadow-lg hover:shadow-xl hover:scale-105 transform"
              >
                <img
                  src={user.photoURL || "https://via.placeholder.com/48"}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              </button>

              {showProfileMenu && (
                <div className="absolute right-0 mt-3 w-64 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-700 py-2 z-10 backdrop-blur-xl">
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {user.displayName}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {user.email}
                    </p>
                  </div>
                  <button
                    onClick={handleSignOut}
                    className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors font-medium"
                  >
                    🚪 Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Side - Form */}
          <div className="lg:col-span-1">
            <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-3xl shadow-xl p-8 sticky top-24 border border-gray-100 dark:border-slate-700 transition-colors">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-400 dark:from-cyan-500 dark:to-blue-500 rounded-xl flex items-center justify-center">
                  <span className="text-white text-xl">📝</span>
                </div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                  New Catch
                </h2>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                    Fish Photo
                  </label>
                  {previewUrl ? (
                    <div className="relative">
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="w-full h-48 object-cover rounded-2xl"
                      />
                      <button
                        onClick={() => {
                          setSelectedFile(null);
                          setPreviewUrl(null);
                        }}
                        className="absolute top-2 right-2 bg-red-500 text-white w-8 h-8 rounded-full hover:bg-red-600 transition-colors shadow-lg"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <label className="block border-2 border-dashed border-blue-300 dark:border-cyan-500 rounded-2xl p-8 text-center hover:border-blue-500 dark:hover:border-cyan-400 transition-all cursor-pointer bg-blue-50/50 dark:bg-slate-700/50 hover:bg-blue-50 dark:hover:bg-slate-700 group">
                      <div className="text-blue-500 dark:text-cyan-400 text-4xl mb-2 group-hover:scale-110 transition-transform">
                        📸
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-2">
                        Click to upload
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        or drag and drop
                      </p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    📍 Location
                  </label>
                  <input
                    type="text"
                    value={catchDetails.location}
                    onChange={(e) =>
                      setCatchDetails({
                        ...catchDetails,
                        location: e.target.value,
                      })
                    }
                    className="w-full px-4 py-3 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-400 focus:border-transparent transition-all"
                    placeholder="Lake Michigan"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    🎣 Method
                  </label>
                  <input
                    type="text"
                    value={catchDetails.method}
                    onChange={(e) =>
                      setCatchDetails({
                        ...catchDetails,
                        method: e.target.value,
                      })
                    }
                    className="w-full px-4 py-3 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-400 focus:border-transparent transition-all"
                    placeholder="Fly fishing"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    💭 Notes
                  </label>
                  <textarea
                    value={catchDetails.notes}
                    onChange={(e) =>
                      setCatchDetails({
                        ...catchDetails,
                        notes: e.target.value,
                      })
                    }
                    className="w-full px-4 py-3 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-400 focus:border-transparent resize-none transition-all"
                    rows={3}
                    placeholder="Tell us about this catch..."
                  />
                </div>

                <button
                  onClick={uploadAndIdentify}
                  disabled={!selectedFile || uploading}
                  className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 dark:from-cyan-500 dark:to-blue-500 text-white py-4 rounded-xl font-bold text-lg
                    hover:from-blue-700 hover:to-cyan-600 dark:hover:from-cyan-600 dark:hover:to-blue-600 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed
                    transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] transform"
                >
                  {uploading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg
                        className="animate-spin h-5 w-5 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Identifying Fish...
                    </span>
                  ) : (
                    "✨ Upload & Identify"
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Right Side - Gallery */}
          <div className="lg:col-span-2">
            {/* Tab Navigation */}
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab("my-catches")}
                  className={`px-6 py-3 rounded-full font-semibold transition-all ${
                    activeTab === "my-catches"
                      ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-lg"
                      : "bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-600"
                  }`}
                >
                  My Catches
                </button>
                <button
                  onClick={() => setActiveTab("community")}
                  className={`px-6 py-3 rounded-full font-semibold transition-all ${
                    activeTab === "community"
                      ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-lg"
                      : "bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-600"
                  }`}
                >
                  Community
                </button>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                  {activeTab === "my-catches" ? "Your Catches" : "Community Catches"}
                </h2>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  {activeTab === "my-catches"
                    ? `${catches.length} fish logged`
                    : `${filteredCommunityCatches.length} catches${selectedUserFilter !== "all" ? " (filtered)" : ""}`}
                </p>
              </div>
            </div>

            {/* User Filter - Community tab only */}
            {activeTab === "community" && uniqueUsers.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Filter by angler:
                  </label>
                  <select
                    value={selectedUserFilter}
                    onChange={(e) => setSelectedUserFilter(e.target.value)}
                    className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-400 focus:border-transparent transition-all"
                  >
                    <option value="all">All Anglers</option>
                    {uniqueUsers.map((u) => (
                      <option key={u.userId} value={u.userId}>
                        {u.displayName}
                      </option>
                    ))}
                  </select>
                  {selectedUserFilter !== "all" && (
                    <button
                      onClick={() => setSelectedUserFilter("all")}
                      className="text-sm text-blue-500 dark:text-cyan-400 hover:underline"
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              </div>
            )}

            {(activeTab === "my-catches" ? catches : filteredCommunityCatches).length === 0 ? (
              <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-3xl p-16 text-center border-2 border-dashed border-gray-200 dark:border-slate-600">
                <div className="text-7xl mb-4">🐟</div>
                <p className="text-gray-600 dark:text-gray-300 text-xl font-semibold mb-2">
                  {activeTab === "my-catches" ? "No catches yet" : selectedUserFilter !== "all" ? "No catches from this angler" : "No community catches yet"}
                </p>
                <p className="text-gray-400 dark:text-gray-500">
                  {activeTab === "my-catches"
                    ? "Upload your first fish photo to get started!"
                    : selectedUserFilter !== "all" ? "Try selecting a different angler or clear the filter." : "Be the first to share a catch!"}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {(activeTab === "my-catches" ? catches : filteredCommunityCatches).map((catch_) => (
                  <div
                    key={catch_.id}
                    onClick={() => {
                      setSelectedCatch(catch_);
                      setIsEditing(false);
                    }}
                    className="bg-white dark:bg-slate-800 rounded-3xl overflow-hidden shadow-lg hover:shadow-2xl transition-all hover:scale-[1.02] transform border border-gray-100 dark:border-slate-700 cursor-pointer"
                  >
                    <div className="relative h-56 bg-gradient-to-br from-blue-100 to-cyan-100 dark:from-slate-700 dark:to-slate-600 overflow-hidden">
                      <img
                        src={catch_.imageUrl}
                        alt={catch_.identification.commonName}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-3 right-3">
                        <span
                          className={`px-3 py-1.5 rounded-full text-xs font-bold shadow-lg ${
                            catch_.identification.confidence === "high"
                              ? "bg-green-500 text-white"
                              : catch_.identification.confidence === "medium"
                              ? "bg-yellow-500 text-white"
                              : "bg-red-500 text-white"
                          }`}
                        >
                          {catch_.identification.confidence.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="p-6">
                      <h3 className="font-bold text-2xl text-gray-900 dark:text-white mb-1">
                        {catch_.identification.commonName}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 italic mb-3">
                        {catch_.identification.scientificName}
                      </p>

                      {/* User Info - Show in Community tab */}
                      {activeTab === "community" && catch_.userDisplayName && (
                        <div
                          className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100 dark:border-slate-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 -mx-2 px-2 py-1 rounded-lg transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (catch_.userId) setSelectedUserFilter(catch_.userId);
                          }}
                          title={`Filter by ${catch_.userDisplayName}`}
                        >
                          {catch_.userPhotoURL ? (
                            <img
                              src={catch_.userPhotoURL}
                              alt={catch_.userDisplayName}
                              className="w-8 h-8 rounded-full object-cover border-2 border-blue-300 dark:border-cyan-500"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-cyan-400 flex items-center justify-center text-white text-sm font-bold">
                              {catch_.userDisplayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="text-sm text-gray-600 dark:text-gray-400 font-medium hover:text-blue-500 dark:hover:text-cyan-400">
                            {catch_.userDisplayName}
                            {isOwnCatch(catch_) && (
                              <span className="ml-1 text-xs text-blue-500 dark:text-cyan-400">
                                (You)
                              </span>
                            )}
                          </span>
                        </div>
                      )}

                      <div className="space-y-2.5 text-sm">
                        {catch_.catchDetails.location && (
                          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                            <span className="text-lg">📍</span>
                            <span className="font-medium">
                              {catch_.catchDetails.location}
                            </span>
                          </div>
                        )}

                        {catch_.catchDetails.method && (
                          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                            <span className="text-lg">🎣</span>
                            <span className="font-medium">
                              {catch_.catchDetails.method}
                            </span>
                          </div>
                        )}

                        {catch_.catchDetails.notes && (
                          <div className="mt-3 p-3 bg-blue-50 dark:bg-slate-700 rounded-xl border border-blue-100 dark:border-slate-600">
                            <p className="text-gray-600 dark:text-gray-300 italic text-sm">
                              "{catch_.catchDetails.notes}"
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
                        Click for details
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Detail Modal */}
      {selectedCatch && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => {
            setSelectedCatch(null);
            setIsEditing(false);
          }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close, Edit, and Delete Buttons */}
            <div className="absolute top-4 right-4 flex gap-2 z-10">
              {!isEditing ? (
                <>
                  {/* Only show Edit/Delete if user owns this catch */}
                  {isOwnCatch(selectedCatch) && (
                    <>
                      <button
                        onClick={handleEditCatch}
                        className="w-10 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-full flex items-center justify-center shadow-lg transition-colors"
                        title="Edit catch"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={handleDeleteCatch}
                        className="w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg transition-colors"
                        title="Delete catch"
                      >
                        🗑️
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setSelectedCatch(null);
                      setIsEditing(false);
                    }}
                    className="w-10 h-10 bg-gray-500 hover:bg-gray-600 text-white rounded-full flex items-center justify-center shadow-lg transition-colors"
                    title="Close"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleSaveEdit}
                    className="px-4 h-10 bg-green-500 hover:bg-green-600 text-white rounded-full flex items-center justify-center shadow-lg transition-colors font-semibold text-sm"
                  >
                    💾 Save
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="w-10 h-10 bg-gray-500 hover:bg-gray-600 text-white rounded-full flex items-center justify-center shadow-lg transition-colors"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>

            {/* Image - Clickable for full view */}
            <div
              className="relative h-80 bg-gradient-to-br from-blue-100 to-cyan-100 dark:from-slate-700 dark:to-slate-600 cursor-pointer group"
              onClick={() => setFullPhotoUrl(selectedCatch.imageUrl)}
            >
              <img
                src={selectedCatch.imageUrl}
                alt={selectedCatch.identification.commonName}
                className="w-full h-full object-cover"
              />
              {/* Click hint overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                <span className="text-white text-lg font-semibold opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 px-4 py-2 rounded-full">
                  Click to view full photo
                </span>
              </div>
              <div className="absolute top-4 left-4">
                <span
                  className={`px-4 py-2 rounded-full text-sm font-bold shadow-lg ${
                    selectedCatch.identification.confidence === "high"
                      ? "bg-green-500 text-white"
                      : selectedCatch.identification.confidence === "medium"
                      ? "bg-yellow-500 text-white"
                      : "bg-red-500 text-white"
                  }`}
                >
                  {selectedCatch.identification.confidence.toUpperCase()}{" "}
                  CONFIDENCE
                </span>
              </div>
            </div>

            {/* Content */}
            <div className="p-8">
              {/* Title - Editable */}
              <div className="mb-6">
                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        🐟 Common Name
                      </label>
                      <input
                        type="text"
                        value={editedDetails.commonName}
                        onChange={(e) =>
                          setEditedDetails({
                            ...editedDetails,
                            commonName: e.target.value,
                          })
                        }
                        className="w-full px-4 py-3 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-600 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-400 focus:border-transparent text-2xl font-bold"
                        placeholder="Enter common name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        🔬 Scientific Name
                      </label>
                      <input
                        type="text"
                        value={editedDetails.scientificName}
                        onChange={(e) =>
                          setEditedDetails({
                            ...editedDetails,
                            scientificName: e.target.value,
                          })
                        }
                        className="w-full px-4 py-3 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-600 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-400 focus:border-transparent text-lg italic"
                        placeholder="Enter scientific name"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 className="text-4xl font-black text-gray-900 dark:text-white mb-2">
                      {selectedCatch.identification.commonName}
                    </h2>
                    <p className="text-xl text-gray-500 dark:text-gray-400 italic">
                      {selectedCatch.identification.scientificName}
                    </p>
                    {selectedCatch.identification.family && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Family: {selectedCatch.identification.family}
                      </p>
                    )}

                    {/* User Info in Modal */}
                    {selectedCatch.userDisplayName && (
                      <div className="flex items-center gap-3 mt-4 p-3 bg-gray-50 dark:bg-slate-700 rounded-xl">
                        {selectedCatch.userPhotoURL ? (
                          <img
                            src={selectedCatch.userPhotoURL}
                            alt={selectedCatch.userDisplayName}
                            className="w-10 h-10 rounded-full object-cover border-2 border-blue-300 dark:border-cyan-500"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-cyan-400 flex items-center justify-center text-white font-bold">
                            {selectedCatch.userDisplayName.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            Caught by
                          </span>
                          <p className="font-semibold text-gray-800 dark:text-white">
                            {selectedCatch.userDisplayName}
                            {isOwnCatch(selectedCatch) && (
                              <span className="ml-2 text-xs text-blue-500 dark:text-cyan-400">
                                (You)
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Catch Details - Editable */}
              <div className="mb-6 p-5 bg-blue-50 dark:bg-slate-700 rounded-2xl border border-blue-100 dark:border-slate-600">
                <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
                  <span>📊</span> Catch Details
                  {isEditing && (
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                      (Editing)
                    </span>
                  )}
                </h3>
                <div className="space-y-3 text-sm">
                  {/* Location */}
                  <div className="flex items-start gap-2">
                    <span className="text-lg">📍</span>
                    <div className="flex-1">
                      <span className="font-semibold text-gray-700 dark:text-gray-300">
                        Location:{" "}
                      </span>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedDetails.location}
                          onChange={(e) =>
                            setEditedDetails({
                              ...editedDetails,
                              location: e.target.value,
                            })
                          }
                          className="w-full mt-1 px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-600 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-400 focus:border-transparent"
                          placeholder="Enter location"
                        />
                      ) : (
                        <span className="text-gray-600 dark:text-gray-400">
                          {selectedCatch.catchDetails.location ||
                            "Not specified"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Method */}
                  <div className="flex items-start gap-2">
                    <span className="text-lg">🎣</span>
                    <div className="flex-1">
                      <span className="font-semibold text-gray-700 dark:text-gray-300">
                        Method:{" "}
                      </span>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedDetails.method}
                          onChange={(e) =>
                            setEditedDetails({
                              ...editedDetails,
                              method: e.target.value,
                            })
                          }
                          className="w-full mt-1 px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-600 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-400 focus:border-transparent"
                          placeholder="Enter method"
                        />
                      ) : (
                        <span className="text-gray-600 dark:text-gray-400">
                          {selectedCatch.catchDetails.method || "Not specified"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Date */}
                  {selectedCatch.catchDetails.date && (
                    <div className="flex items-start gap-2">
                      <span className="text-lg">📅</span>
                      <div>
                        <span className="font-semibold text-gray-700 dark:text-gray-300">
                          Date:{" "}
                        </span>
                        <span className="text-gray-600 dark:text-gray-400">
                          {new Date(
                            selectedCatch.catchDetails.date
                          ).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  <div className="flex items-start gap-2 pt-3 border-t border-blue-200 dark:border-slate-600">
                    <span className="text-lg">💭</span>
                    <div className="flex-1">
                      <span className="font-semibold text-gray-700 dark:text-gray-300">
                        Notes:{" "}
                      </span>
                      {isEditing ? (
                        <textarea
                          value={editedDetails.notes}
                          onChange={(e) =>
                            setEditedDetails({
                              ...editedDetails,
                              notes: e.target.value,
                            })
                          }
                          className="w-full mt-1 px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-600 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 dark:focus:ring-cyan-400 focus:border-transparent resize-none"
                          rows={3}
                          placeholder="Enter notes"
                        />
                      ) : (
                        <p className="text-gray-600 dark:text-gray-400 italic mt-1">
                          {selectedCatch.catchDetails.notes
                            ? `"${selectedCatch.catchDetails.notes}"`
                            : "No notes"}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Fish Information */}
              <div className="space-y-5">
                {selectedCatch.identification.averageSize && (
                  <div>
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-2 flex items-center gap-2">
                      <span>📏</span> Average Size
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400">
                      {selectedCatch.identification.averageSize}
                    </p>
                  </div>
                )}

                {selectedCatch.identification.habitat && (
                  <div>
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-2 flex items-center gap-2">
                      <span>🌊</span> Habitat
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400">
                      {selectedCatch.identification.habitat}
                    </p>
                  </div>
                )}

                {selectedCatch.identification.characteristics &&
                  selectedCatch.identification.characteristics.length > 0 && (
                    <div>
                      <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
                        <span>✨</span> Key Characteristics
                      </h3>
                      <ul className="space-y-2">
                        {selectedCatch.identification.characteristics.map(
                          (char, idx) => (
                            <li
                              key={idx}
                              className="flex items-start gap-2 text-gray-600 dark:text-gray-400"
                            >
                              <span className="text-blue-500 dark:text-cyan-400 mt-1">
                                •
                              </span>
                              <span>{char}</span>
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}

                {selectedCatch.identification.notes && (
                  <div>
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-2 flex items-center gap-2">
                      <span>ℹ️</span> Additional Information
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400">
                      {selectedCatch.identification.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full Photo Modal */}
      {fullPhotoUrl && (
        <div
          className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4"
          onClick={() => setFullPhotoUrl(null)}
        >
          <button
            onClick={() => setFullPhotoUrl(null)}
            className="absolute top-4 right-4 w-12 h-12 bg-white/20 hover:bg-white/30 text-white rounded-full flex items-center justify-center text-2xl transition-colors z-10"
          >
            ✕
          </button>
          <img
            src={fullPhotoUrl}
            alt="Full size"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export default App;
