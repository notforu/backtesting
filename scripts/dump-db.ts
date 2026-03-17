import * as pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://backtesting:backtesting@localhost:5432/backtesting';

async function dumpDatabase() {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  
  try {
    // Get all tables
    const tablesResult = await pool.query(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public' 
      ORDER BY tablename
    `);
    
    const tables = tablesResult.rows.map(r => r.tablename);
    console.log(`-- PostgreSQL Database Dump`);
    console.log(`-- Database: backtesting`);
    console.log(`-- Date: ${new Date().toISOString()}`);
    console.log(`-- Tables: ${tables.join(', ')}`);
    console.log('');
    
    // Get table counts first
    for (const table of tables) {
      const countResult = await pool.query(`SELECT COUNT(*) as cnt FROM "${table}"`);
      console.error(`Table ${table}: ${countResult.rows[0].cnt} rows`);
    }
    
    // Dump schema (CREATE TABLE statements)
    for (const table of tables) {
      // Get column definitions
      const colsResult = await pool.query(`
        SELECT column_name, data_type, column_default, is_nullable, 
               character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [table]);
      
      console.log(`-- Table: ${table}`);
      console.log(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
      
      const colDefs = colsResult.rows.map(col => {
        let type = col.data_type;
        if (col.character_maximum_length) type += `(${col.character_maximum_length})`;
        if (col.data_type === 'numeric' && col.numeric_precision) type += `(${col.numeric_precision},${col.numeric_scale})`;
        let def = `  "${col.column_name}" ${type}`;
        if (col.column_default) def += ` DEFAULT ${col.column_default}`;
        if (col.is_nullable === 'NO') def += ` NOT NULL`;
        return def;
      });
      
      // Get primary key
      const pkResult = await pool.query(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position
      `, [table]);
      
      if (pkResult.rows.length > 0) {
        colDefs.push(`  PRIMARY KEY (${pkResult.rows.map(r => `"${r.column_name}"`).join(', ')})`);
      }
      
      console.log(`CREATE TABLE "${table}" (`);
      console.log(colDefs.join(',\n'));
      console.log(`);`);
      console.log('');
      
      // Get indexes
      const idxResult = await pool.query(`
        SELECT indexdef FROM pg_indexes 
        WHERE tablename = $1 AND schemaname = 'public'
        AND indexname NOT LIKE '%_pkey'
      `, [table]);
      
      for (const idx of idxResult.rows) {
        console.log(`${idx.indexdef};`);
      }
      if (idxResult.rows.length > 0) console.log('');
    }
    
    // Dump data
    console.log('');
    console.log('-- Data');
    console.log('');
    
    for (const table of tables) {
      const countResult = await pool.query(`SELECT COUNT(*) as cnt FROM "${table}"`);
      const count = parseInt(countResult.rows[0].cnt);
      
      if (count === 0) {
        console.log(`-- Table "${table}": empty`);
        console.log('');
        continue;
      }
      
      console.log(`-- Table "${table}": ${count} rows`);
      
      // Get column names
      const colsResult = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [table]);
      const colNames = colsResult.rows.map(r => r.column_name);
      
      // Dump in batches
      const batchSize = 500;
      for (let offset = 0; offset < count; offset += batchSize) {
        const dataResult = await pool.query(`SELECT * FROM "${table}" LIMIT ${batchSize} OFFSET ${offset}`);
        
        for (const row of dataResult.rows) {
          const values = colNames.map(col => {
            const val = row[col];
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'number') return val.toString();
            if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
            if (val instanceof Date) return `'${val.toISOString()}'`;
            if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
            return `'${String(val).replace(/'/g, "''")}'`;
          });
          
          console.log(`INSERT INTO "${table}" (${colNames.map(c => `"${c}"`).join(', ')}) VALUES (${values.join(', ')});`);
        }
      }
      console.log('');
    }
    
    console.log('-- End of dump');
    
  } finally {
    await pool.end();
  }
}

dumpDatabase().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
