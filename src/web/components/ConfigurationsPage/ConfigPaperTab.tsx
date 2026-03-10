/**
 * ConfigPaperTab — placeholder for paper trading sessions linked to a config.
 */

interface ConfigPaperTabProps {
  configId: string;
}

export function ConfigPaperTab({ configId: _configId }: ConfigPaperTabProps) {
  return (
    <div
      style={{
        padding: '24px 0',
        textAlign: 'center',
        color: '#555',
        fontSize: 13,
      }}
    >
      Paper trading sessions for this configuration will appear here.
    </div>
  );
}
