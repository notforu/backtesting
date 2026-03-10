/**
 * Modal overlay for the login page.
 */

import { LoginPage } from '../LoginPage';

interface LoginModalProps {
  onClose: () => void;
}

export function LoginModal({ onClose }: LoginModalProps) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
      <div className="relative">
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-sm font-bold z-10 transition-colors"
          aria-label="Close login"
        >
          ×
        </button>
        <LoginPage onSuccess={onClose} />
      </div>
    </div>
  );
}
