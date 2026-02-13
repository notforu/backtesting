/**
 * Polymarket market browser component.
 * Allows searching and selecting prediction markets.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchPolymarketMarkets } from '../../api/client';

interface PolymarketBrowserProps {
  onSelect: (slug: string) => void;
  selectedSlug?: string;
}

export function PolymarketBrowser({ onSelect, selectedSlug }: PolymarketBrowserProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch markets with search filter
  const { data: markets, isLoading, error } = useQuery({
    queryKey: ['polymarket-markets', debouncedSearch],
    queryFn: () => searchPolymarketMarkets({
      search: debouncedSearch || undefined,
      active: 'true',
      limit: 20,
    }),
    staleTime: 60000, // Cache for 1 minute
  });

  const handleSelect = useCallback((slug: string) => {
    onSelect(slug);
  }, [onSelect]);

  const inputClass = 'w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';

  return (
    <div className="space-y-2">
      <label className="block text-sm text-gray-400 mb-1">Polymarket Market</label>

      {/* Search input */}
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search markets..."
        className={inputClass}
      />

      {/* Markets list */}
      <div className="max-h-64 overflow-y-auto border border-gray-600 rounded bg-gray-700">
        {isLoading && (
          <div className="p-4 text-center text-gray-400 text-sm">
            Loading markets...
          </div>
        )}

        {error && (
          <div className="p-4 text-center text-red-400 text-sm">
            Error loading markets: {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        )}

        {!isLoading && !error && markets && markets.length === 0 && (
          <div className="p-4 text-center text-gray-400 text-sm">
            No markets found
          </div>
        )}

        {!isLoading && !error && markets && markets.length > 0 && (
          <div className="divide-y divide-gray-600">
            {markets.map((market) => (
              <button
                key={market.slug}
                onClick={() => handleSelect(market.slug)}
                className={`
                  w-full text-left p-3 hover:bg-gray-600 transition-colors
                  ${selectedSlug === market.slug ? 'bg-primary-900/30 border-l-2 border-primary-500' : ''}
                `}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium line-clamp-2 mb-1">
                      {market.question}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`
                        text-xs px-1.5 py-0.5 rounded
                        ${market.active ? 'bg-green-900/50 text-green-400' : 'bg-gray-600 text-gray-400'}
                      `}>
                        {market.active ? 'Active' : 'Inactive'}
                      </span>
                      {market.category && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-400">
                          {market.category}
                        </span>
                      )}
                      {market.volumeNum && market.volumeNum > 0 && (
                        <span className="text-xs text-gray-400">
                          Vol: ${(market.volumeNum / 1000).toFixed(1)}K
                        </span>
                      )}
                    </div>
                  </div>
                  {selectedSlug === market.slug && (
                    <svg className="w-5 h-5 text-primary-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedSlug && (
        <div className="text-xs text-gray-400 mt-1">
          Selected: PM:{selectedSlug}
        </div>
      )}
    </div>
  );
}

export default PolymarketBrowser;
