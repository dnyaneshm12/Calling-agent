
import React from 'react';
import CallingAgent from './components/CallingAgent';

function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-2xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
            Innovate Inc. AI Assistant
          </h1>
          <p className="text-gray-400 mt-2">
            Your personal guide to our services. Press the call button to begin.
          </p>
        </header>
        <main>
          <CallingAgent />
        </main>
        <footer className="text-center mt-8 text-gray-500 text-sm">
          <p>Powered by Gemini</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
