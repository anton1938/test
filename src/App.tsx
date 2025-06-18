import React, { useState, useEffect } from 'react';
import {
  Button,
  Checkbox,
  Container,
  Divider,
  FormControl,
  InputAdornment,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  type SelectChangeEvent,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton
} from '@mui/material';
import {
  AttachMoney as AttachMoneyIcon,
  CurrencyRuble as CurrencyRubleIcon,
  Upload as UploadIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { openDB } from 'idb';
import axios from 'axios';

const USD_RATE_API = 'https://open.er-api.com/v6/latest/USD';
const DB_NAME = 'expenses-db';
const STORE_NAME = 'expenses';
const INCOME_STORAGE_KEY = 'income-data';

interface Expense {
  id: number;
  name: string;
  amountUSD: number;
  constant: boolean;
  checked: boolean;
}

interface IncomeData {
  salary: number;
  advance: number;
}

async function getDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    },
  });
}

const loadIncomeFromStorage = (): IncomeData => {
  const saved = localStorage.getItem(INCOME_STORAGE_KEY);
  return saved ? JSON.parse(saved) : { salary: 0, advance: 0 };
};

const saveIncomeToStorage = (salary: number, advance: number) => {
  localStorage.setItem(INCOME_STORAGE_KEY, JSON.stringify({ salary, advance }));
};

const App: React.FC = () => {
  const initialIncome = loadIncomeFromStorage();
  const [salary, setSalary] = useState(initialIncome.salary);
  const [advance, setAdvance] = useState(initialIncome.advance);
  const [rate, setRate] = useState(1);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [modalType, setModalType] = useState<'constant' | 'regular' | 'edit' | null>(null);
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState(0);
  const [newCurrency, setNewCurrency] = useState<'USD' | 'BYN'>('BYN');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('1');
  const [showReceipt] = useState(true);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const allExpenses = await db.getAll(STORE_NAME);
      setExpenses(allExpenses);
    })();
  }, []);

  useEffect(() => {
    axios.get(USD_RATE_API)
      .then(res => {
        const bynRate = res.data.rates?.BYN;
        if (bynRate) setRate(bynRate);
      })
      .catch(err => console.error('Ошибка курса USD->BYN', err));
  }, []);

  useEffect(() => {
    saveIncomeToStorage(salary, advance);
  }, [salary, advance]);

  const convertToUSD = (amount: number, currency: 'USD' | 'BYN') =>
    currency === 'USD' ? amount : amount / rate;

  const totalBYN = salary + advance;
  const totalUSD = (totalBYN / rate).toFixed(2);

  const constantExpenses = expenses.filter(e => e.constant);
  const regularExpenses = expenses.filter(e => !e.constant);

  const usedUSD = expenses.reduce((sum, e) => e.checked ? sum + e.amountUSD : sum, 0);
  const usedBYN = usedUSD * rate;

  const left = totalBYN - usedBYN;

  const addExpense = async (constant: boolean) => {
    if (!newName.trim() || newAmount <= 0) return alert('Заполните поля');
    const db = await getDb();
    const amountInUSD = convertToUSD(newAmount, newCurrency);
    const newExp: Expense = {
      id: Date.now(),
      name: newName.trim(),
      amountUSD: amountInUSD,
      constant,
      checked: true
    };
    await db.add(STORE_NAME, newExp);
    setExpenses([...expenses, newExp]);
    setModalType(null);
    setNewName('');
    setNewAmount(0);
    setNewCurrency('BYN');
    setActiveTab(constant ? '1' : '2');
  };

  const editExpense = async () => {
    if (!newName.trim() || newAmount <= 0 || !editingId) return alert('Заполните поля');
    const db = await getDb();
    const amountInUSD = convertToUSD(newAmount, newCurrency);
    const expenseToEdit = expenses.find(e => e.id === editingId);
    if (!expenseToEdit) return;

    const updatedExpense = {
      ...expenseToEdit,
      name: newName.trim(),
      amountUSD: amountInUSD
    };

    await db.put(STORE_NAME, updatedExpense);
    setExpenses(expenses.map(e => e.id === editingId ? updatedExpense : e));
    setModalType(null);
    setNewName('');
    setNewAmount(0);
    setNewCurrency('BYN');
    setEditingId(null);
  };

  const deleteExpense = async (id: number) => {
    if (!window.confirm('Удалить эту запись?')) return;
    const db = await getDb();
    await db.delete(STORE_NAME, id);
    setExpenses(expenses.filter(e => e.id !== id));
  };

  const handleEditClick = (expense: Expense) => {
    setEditingId(expense.id);
    if (expense.amountUSD * rate < 1000) {
      setNewAmount(expense.amountUSD * rate);
      setNewCurrency('BYN');
    } else {
      setNewAmount(expense.amountUSD);
      setNewCurrency('USD');
    }
    setNewName(expense.name);
    setModalType('edit');
  };

  const toggleChecked = async (expense: Expense, checked: boolean) => {
    const db = await getDb();
    const updatedExpense = { ...expense, checked };
    await db.put(STORE_NAME, updatedExpense);
    setExpenses(expenses.map(e => e.id === expense.id ? updatedExpense : e));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const html = reader.result as string;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const rows = Array.from(doc.querySelectorAll('tr'));
      const normalize = (text: string): number => parseFloat(text.replace(/[^\d,.]/g, '').replace(',', '.')) || 0;
      let advanceValue = 0, salaryValue = 0;
      for (const row of rows) {
        const tds = Array.from(row.querySelectorAll('td'));
        if (tds.length < 6) continue;
        const code = tds[3].textContent?.trim();
        const raw = tds[5]?.textContent || '';
        if (code === '199') advanceValue = normalize(raw);
        if (code === '220') salaryValue = normalize(raw);
      }
      setAdvance(advanceValue);
      setSalary(salaryValue);
    };
    reader.readAsText(file);
  };

  const renderExpenseList = (expensesList: Expense[]) => (
    <List dense>
      {expensesList.map(expense => (
        <ListItem
          key={expense.id}
          secondaryAction={
            <Stack direction="row" spacing={1}>
              <IconButton edge="end" onClick={() => handleEditClick(expense)}>
                <EditIcon />
              </IconButton>
              <IconButton edge="end" onClick={() => deleteExpense(expense.id)}>
                <DeleteIcon />
              </IconButton>
            </Stack>
          }
          disablePadding
        >
          <ListItemButton onClick={() => toggleChecked(expense, !expense.checked)}>
            <ListItemIcon>
              <Checkbox
                edge="start"
                checked={expense.checked}
                tabIndex={-1}
                disableRipple
              />
            </ListItemIcon>
            <ListItemText
              primary={expense.name}
              secondary={`${expense.amountUSD.toFixed(2)} USD (${(expense.amountUSD * rate).toFixed(2)} BYN)`}
              sx={{
                textDecoration: expense.checked ? 'none' : 'line-through',
                opacity: expense.checked ? 1 : 0.6
              }}
            />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  );

  const renderReceipt = () => {
    const checkedExpenses = expenses.filter(e => e.checked);
    const totalExpensesUSD = checkedExpenses.reduce((sum, e) => sum + e.amountUSD, 0);
    const totalExpensesBYN = totalExpensesUSD * rate;

    return (
      <Paper elevation={3} sx={{ p: 2, mt: 3 }}>
        <Typography variant="h6" align="center">Итоговый чек</Typography>
        <Divider sx={{ my: 2 }} />
        
        <Typography fontWeight="bold" gutterBottom>
          Общий доход: {totalBYN.toFixed(2)} BYN ({totalUSD} USD)
        </Typography>
        
        <Divider textAlign="left">Расходы</Divider>
        {checkedExpenses.map(expense => (
          <Typography key={expense.id} gutterBottom>
            - {expense.name}: {expense.amountUSD.toFixed(2)} USD ({(expense.amountUSD * rate).toFixed(2)} BYN)
          </Typography>
        ))}
        
        <Divider sx={{ my: 2 }} />
        <Typography fontWeight="bold">
          Итого расходов: {totalExpensesUSD.toFixed(2)} USD ({totalExpensesBYN.toFixed(2)} BYN)
        </Typography>
        
        <Typography fontWeight="bold" sx={{ mt: 2, fontSize: 16 }}>
          Остаток: {(left / rate).toFixed(2)} USD ({left.toFixed(2)} BYN)
        </Typography>
      </Paper>
    );
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Планировщик расходов
      </Typography>

      <Button
        component="label"
        variant="contained"
        startIcon={<UploadIcon />}
        sx={{ mb: 3 }}
      >
        Загрузить расчетный HTML
        <input type="file" hidden accept=".html" onChange={handleFileUpload} />
      </Button>

      <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h5" gutterBottom>Доходы</Typography>
        <Stack spacing={2}>
          <TextField
            label="ЗП (BYN)"
            type="number"
            value={salary}
            onChange={e => setSalary(parseFloat(e.target.value) || 0)}
            fullWidth
            InputProps={{
              endAdornment: <InputAdornment position="end">BYN</InputAdornment>,
            }}
          />
          <TextField
            label="Аванс (BYN)"
            type="number"
            value={advance}
            onChange={e => setAdvance(parseFloat(e.target.value) || 0)}
            fullWidth
            InputProps={{
              endAdornment: <InputAdornment position="end">BYN</InputAdornment>,
            }}
          />
          <Typography fontWeight="bold">
            Итого: {totalBYN.toFixed(2)} BYN ({totalUSD} USD)
          </Typography>
          <Typography color="text.secondary">
            Курс: 1 USD = {rate.toFixed(4)} BYN
          </Typography>
        </Stack>
      </Paper>

      <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h5">Затраты</Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={() => setModalType('constant')}>
              Добавить постоянные
            </Button>
            <Button variant="contained" onClick={() => setModalType('regular')}>
              Добавить обычные
            </Button>
          </Stack>
        </Stack>

        <Tabs value={activeTab} onChange={(_e:any, newValue) => setActiveTab(newValue)}>
          <Tab label="Постоянные" value="1" />
          <Tab label="Обычные" value="2" />
        </Tabs>

        {activeTab === '1' && (
          <>
            {renderExpenseList(constantExpenses)}
            <Typography fontWeight="bold" sx={{ mt: 2 }}>
              Итого постоянные (учитываются): {constantExpenses.filter(e => e.checked).reduce((sum, e) => sum + e.amountUSD, 0).toFixed(2)} USD (
              {constantExpenses.filter(e => e.checked).reduce((sum, e) => sum + e.amountUSD * rate, 0).toFixed(2)} BYN)
            </Typography>
          </>
        )}

        {activeTab === '2' && (
          <>
            {renderExpenseList(regularExpenses)}
            <Typography fontWeight="bold" sx={{ mt: 2 }}>
              Итого обычные (учитываются): {regularExpenses.filter(e => e.checked).reduce((sum, e) => sum + e.amountUSD, 0).toFixed(2)} USD (
              {regularExpenses.filter(e => e.checked).reduce((sum, e) => sum + e.amountUSD * rate, 0).toFixed(2)} BYN)
            </Typography>
          </>
        )}
      </Paper>

      {showReceipt && renderReceipt()}

      <Dialog open={!!modalType} onClose={() => setModalType(null)}>
        <DialogTitle>
          {modalType === 'constant' ? 'Добавить постоянные расходы' :
           modalType === 'regular' ? 'Добавить обычные расходы' : 'Редактировать'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Название"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              fullWidth
            />
            <TextField
              label="Сумма"
              type="number"
              value={newAmount}
              onChange={e => setNewAmount(parseFloat(e.target.value) || 0)}
              fullWidth
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    {newCurrency === 'USD' ? <AttachMoneyIcon /> : <CurrencyRubleIcon />}
                  </InputAdornment>
                ),
              }}
            />
            <FormControl fullWidth>
              <InputLabel>Валюта</InputLabel>
              <Select
                value={newCurrency}
                label="Валюта"
                onChange={(e: SelectChangeEvent<'USD' | 'BYN'>) => setNewCurrency(e.target.value as 'USD' | 'BYN')}
              >
                <MenuItem value="USD">USD</MenuItem>
                <MenuItem value="BYN">BYN</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalType(null)}>Отмена</Button>
          <Button
            onClick={() => modalType === 'edit' ? editExpense() : addExpense(modalType === 'constant')}
            variant="contained"
          >
            {modalType === 'edit' ? 'Сохранить' : 'Добавить'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default App;