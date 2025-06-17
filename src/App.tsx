import React, { useState, useEffect } from 'react';
import { Layout, Row, Col, InputNumber, Button, List, Modal, Space, Upload, message, Checkbox, Select, Popconfirm, Tabs, Divider } from 'antd';
import { UploadOutlined, EditOutlined, DeleteOutlined, PrinterOutlined } from '@ant-design/icons';
import Typography from 'antd/es/typography';
import { openDB } from 'idb';
import axios from 'axios';

const { Header, Content, Footer } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;
const { TabPane } = Tabs;

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
  const [showReceipt, setShowReceipt] = useState(true);

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
    if (!newName.trim() || newAmount <= 0) return message.error('Заполните поля');
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
    if (!newName.trim() || newAmount <= 0 || !editingId) return message.error('Заполните поля');
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
    const db = await getDb();
    await db.delete(STORE_NAME, id);
    setExpenses(expenses.filter(e => e.id !== id));
    message.success('Расход удален');
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

  const handleFileUpload = (file: File) => {
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
      message.success('HTML-файл обработан');
    };
    reader.readAsText(file);
    return false;
  };

  const renderExpenseList = (expensesList: Expense[]) => (
    <List
      bordered
      style={{ marginTop: 10 }}
      dataSource={expensesList}
      renderItem={e => (
        <List.Item
          actions={[
            <Checkbox
              checked={e.checked}
              onChange={ev => toggleChecked(e, ev.target.checked)}
            />,
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEditClick(e)}
            />,
            <Popconfirm
              title="Удалить эту запись?"
              onConfirm={() => deleteExpense(e.id)}
              okText="Да"
              cancelText="Нет"
            >
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          ]}
        >
          <span style={{ textDecoration: e.checked ? 'none' : 'line-through', opacity: e.checked ? 1 : 0.6 }}>
            {e.name}: {e.amountUSD.toFixed(2)} USD ({(e.amountUSD * rate).toFixed(2)} BYN)
          </span>
        </List.Item>
      )}
    />
  );

  const renderReceipt = () => {
    const checkedExpenses = expenses.filter(e => e.checked);
    const totalExpensesUSD = checkedExpenses.reduce((sum, e) => sum + e.amountUSD, 0);
    const totalExpensesBYN = totalExpensesUSD * rate;

    return (
      <div style={{ background: '#fff', padding: 20, marginTop: 20, borderRadius: 4 }}>
        <Title level={4} style={{ textAlign: 'center' }}>Итоговый чек</Title>
        <Divider />
        
        <Text strong style={{ display: 'block', marginBottom: 10 }}>
          Общий доход: {totalBYN.toFixed(2)} BYN ({totalUSD} USD)
        </Text>
        
        <Divider orientation="left">Расходы</Divider>
        {checkedExpenses.map(expense => (
          <div key={expense.id} style={{ marginBottom: 8 }}>
            - {expense.name}: {expense.amountUSD.toFixed(2)} USD ({(expense.amountUSD * rate).toFixed(2)} BYN)
          </div>
        ))}
        
        <Divider />
        <Text strong style={{ display: 'block' }}>
          Итого расходов: {totalExpensesUSD.toFixed(2)} USD ({totalExpensesBYN.toFixed(2)} BYN)
        </Text>
        
        <Text strong style={{ display: 'block', marginTop: 10, fontSize: 16 }}>
          Остаток: {(left / rate).toFixed(2)} USD ({left.toFixed(2)} BYN)
        </Text>

      </div>
    );
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header><Title level={2} style={{ color: '#fff' }}>Планировщик</Title></Header>
      <Content style={{ padding: 20, maxWidth: 600, margin: 'auto' }}>
        <Upload beforeUpload={handleFileUpload} showUploadList={false} accept=".html">
          <Button icon={<UploadOutlined />}>Загрузить расчетный HTML</Button>
        </Upload>

        <Row gutter={[16, 16]} style={{ marginTop: 20 }}>
          <Col span={24}>
            <Title level={4}>Доходы</Title>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text>ЗП (BYN):</Text>
              <InputNumber 
                value={salary} 
                onChange={v => setSalary(v || 0)} 
                style={{ width: '100%' }} 
                placeholder="2595"
              />
              <Text>Аванс (BYN):</Text>
              <InputNumber 
                value={advance} 
                onChange={v => setAdvance(v || 0)} 
                style={{ width: '100%' }} 
              />
              <Text strong>Итого: {totalBYN.toFixed(2)} BYN ({totalUSD} USD)</Text>
              <Text type="secondary">Курс: 1 USD = {rate.toFixed(4)} BYN</Text>
            </Space>
          </Col>

          <Col span={24} style={{ marginTop: 20 }}>
            <Title level={4}>Затраты</Title>
            <Space>
              <Button onClick={() => setModalType('constant')}>Добавить постоянные</Button>
              <Button onClick={() => setModalType('regular')}>Добавить обычные</Button>
           
            </Space>

            <Tabs activeKey={activeTab} onChange={setActiveTab} style={{ marginTop: 10 }}>
              <TabPane tab="Постоянные" key="1">
                {renderExpenseList(constantExpenses)}
                <Text strong style={{ display: 'block', marginTop: 10 }}>
                  Итого постоянные (учитываются): {constantExpenses.filter(e => e.checked).reduce((sum, e) => sum + e.amountUSD, 0).toFixed(2)} USD (
                  {constantExpenses.filter(e => e.checked).reduce((sum, e) => sum + e.amountUSD * rate, 0).toFixed(2)} BYN)
                </Text>
              </TabPane>
              <TabPane tab="Обычные" key="2">
                {renderExpenseList(regularExpenses)}
                <Text strong style={{ display: 'block', marginTop: 10 }}>
                  Итого обычные (учитываются): {regularExpenses.filter(e => e.checked).reduce((sum, e) => sum + e.amountUSD, 0).toFixed(2)} USD (
                  {regularExpenses.filter(e => e.checked).reduce((sum, e) => sum + e.amountUSD * rate, 0).toFixed(2)} BYN)
                </Text>
              </TabPane>
            </Tabs>
          </Col>
        </Row>

        {showReceipt && renderReceipt()}
      </Content>
      <Modal
        open={!!modalType}
        title={
          modalType === 'constant' ? 'Добавить постоянные расходы' :
          modalType === 'regular' ? 'Добавить обычные расходы' : 'Редактировать'
        }
        onOk={() => modalType === 'edit' ? editExpense() : addExpense(modalType === 'constant')}
        onCancel={() => {
          setModalType(null);
          setNewName('');
          setNewAmount(0);
          setNewCurrency('BYN');
          setEditingId(null);
        }}
        okText={modalType === 'edit' ? 'Сохранить' : 'Добавить'}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>Название:</Text>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            style={{ width: '100%', padding: 8 }}
          />
          <Text>Сумма:</Text>
          <InputNumber
            min={0}
            value={newAmount}
            onChange={val => setNewAmount(val || 0)}
            style={{ width: '100%' }}
          />
          <Select value={newCurrency} onChange={val => setNewCurrency(val)}>
            <Option value="USD">USD</Option>
            <Option value="BYN">BYN</Option>
          </Select>
        </Space>
      </Modal>
    </Layout>
  );
};

export default App;